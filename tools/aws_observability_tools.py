"""
AWS Observability Tools — query CloudWatch metrics, logs, and X-Ray traces.
Incident Agent uses these to investigate production issues.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import boto3
import structlog
from strands import tool

logger = structlog.get_logger(__name__)


def _region() -> str:
    return os.environ.get("AWS_REGION", "ap-northeast-2")


@tool
def get_cloudwatch_metrics(
    namespace: str,
    metric_name: str,
    dimensions: dict[str, str],
    period_minutes: int = 60,
    stat: str = "Average",
) -> str:
    """
    Retrieves CloudWatch metric statistics around the current time.

    Args:
        namespace: CloudWatch namespace (e.g., AWS/Lambda, AWS/DynamoDB)
        metric_name: Metric name (e.g., Errors, Duration, ThrottledRequests)
        dimensions: Dict of dimension name → value
        period_minutes: How many minutes of data to retrieve (default: 60)
        stat: Statistic type: Average | Sum | Maximum | Minimum | SampleCount

    Returns:
        JSON string with metric data points
    """
    cw = boto3.client("cloudwatch", region_name=_region())
    end = datetime.now(timezone.utc)
    start = end - timedelta(minutes=period_minutes)

    response = cw.get_metric_statistics(
        Namespace=namespace,
        MetricName=metric_name,
        Dimensions=[{"Name": k, "Value": v} for k, v in dimensions.items()],
        StartTime=start,
        EndTime=end,
        Period=max(60, period_minutes * 60 // 20),  # ~20 data points
        Statistics=[stat],
    )

    points = sorted(response.get("Datapoints", []), key=lambda x: x["Timestamp"])
    result = {
        "namespace": namespace,
        "metric": metric_name,
        "period_minutes": period_minutes,
        "stat": stat,
        "data_points": [
            {"timestamp": str(p["Timestamp"]), "value": p.get(stat, 0), "unit": p.get("Unit", "")}
            for p in points
        ],
    }
    logger.info("Metrics retrieved", namespace=namespace, metric=metric_name, points=len(points))
    return json.dumps(result, default=str)


@tool
def get_cloudwatch_logs(
    log_group_name: str,
    query: str,
    minutes_back: int = 30,
    limit: int = 50,
) -> str:
    """
    Queries CloudWatch Logs Insights for error patterns.

    Args:
        log_group_name: CloudWatch Log Group name
        query: CloudWatch Logs Insights query string
        minutes_back: How many minutes back to search (default: 30)
        limit: Maximum number of log entries to return (default: 50)

    Returns:
        JSON string with matching log entries
    """
    logs = boto3.client("logs", region_name=_region())
    end = int(datetime.now(timezone.utc).timestamp())
    start = end - (minutes_back * 60)

    response = logs.start_query(
        logGroupName=log_group_name,
        startTime=start,
        endTime=end,
        queryString=query,
        limit=limit,
    )
    query_id = response["queryId"]

    import time
    for _ in range(30):
        result = logs.get_query_results(queryId=query_id)
        if result["status"] in ("Complete", "Failed", "Cancelled"):
            break
        time.sleep(1)

    records = []
    for row in result.get("results", []):
        records.append({field["field"]: field["value"] for field in row})

    logger.info("Log query complete", log_group=log_group_name, records=len(records))
    return json.dumps({"log_group": log_group_name, "query": query, "records": records}, default=str)


@tool
def get_xray_traces(
    service_name: str,
    minutes_back: int = 30,
    filter_expression: str = "error = true",
) -> str:
    """
    Retrieves X-Ray traces for a service to find failed requests.

    Args:
        service_name: Service name as registered in X-Ray
        minutes_back: How far back to search (default: 30)
        filter_expression: X-Ray filter expression (default: error=true)

    Returns:
        JSON string with trace summaries
    """
    xray = boto3.client("xray", region_name=_region())
    end = datetime.now(timezone.utc)
    start = end - timedelta(minutes=minutes_back)

    response = xray.get_trace_summaries(
        StartTime=start,
        EndTime=end,
        FilterExpression=f'service("{service_name}") AND {filter_expression}',
        Sampling=False,
    )

    summaries = response.get("TraceSummaries", [])[:20]
    result = {
        "service": service_name,
        "filter": filter_expression,
        "total_found": len(summaries),
        "traces": [
            {
                "trace_id": t.get("Id"),
                "duration": t.get("Duration"),
                "has_error": t.get("HasError"),
                "has_fault": t.get("HasFault"),
                "response_time": t.get("ResponseTime"),
            }
            for t in summaries
        ],
    }
    logger.info("X-Ray traces retrieved", service=service_name, count=len(summaries))
    return json.dumps(result, default=str)


@tool
def get_related_alarms(alarm_name_prefix: str, state: str = "ALARM") -> str:
    """
    Finds CloudWatch alarms in a given state to identify correlated failures.

    Args:
        alarm_name_prefix: Prefix to filter alarms (e.g., project name)
        state: Alarm state filter: ALARM | INSUFFICIENT_DATA | OK

    Returns:
        JSON string with list of alarms in the given state
    """
    cw = boto3.client("cloudwatch", region_name=_region())
    response = cw.describe_alarms(
        AlarmNamePrefix=alarm_name_prefix,
        StateValue=state,
        MaxRecords=50,
    )

    alarms = [
        {
            "name": a["AlarmName"],
            "state": a["StateValue"],
            "reason": a.get("StateReason", ""),
            "updated": str(a.get("StateUpdatedTimestamp", "")),
            "metric": a.get("MetricName", ""),
            "namespace": a.get("Namespace", ""),
        }
        for a in response.get("MetricAlarms", [])
    ]
    logger.info("Related alarms found", prefix=alarm_name_prefix, count=len(alarms))
    return json.dumps({"state": state, "alarms": alarms}, default=str)


@tool
def get_resource_config(resource_type: str, resource_id: str) -> str:
    """
    Gets the current configuration of an AWS resource from AWS Config.

    Args:
        resource_type: AWS resource type (e.g., AWS::Lambda::Function)
        resource_id: Resource ID or ARN

    Returns:
        JSON string with resource configuration
    """
    config_client = boto3.client("config", region_name=_region())
    try:
        response = config_client.get_resource_config_history(
            resourceType=resource_type,
            resourceId=resource_id,
            limit=1,
        )
        items = response.get("configurationItems", [])
        if not items:
            return json.dumps({"error": f"No config found for {resource_type}/{resource_id}"})

        item = items[0]
        return json.dumps({
            "resource_type": resource_type,
            "resource_id": resource_id,
            "configuration": json.loads(item.get("configuration", "{}")),
            "tags": item.get("tags", {}),
            "capture_time": str(item.get("configurationItemCaptureTime", "")),
        }, default=str)
    except Exception as e:
        logger.error("Config lookup failed", resource_type=resource_type, error=str(e))
        return json.dumps({"error": str(e)})
