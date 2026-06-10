from __future__ import annotations

import os
from typing import Any, TypeVar

import boto3
from boto3.dynamodb.conditions import ConditionBase
from botocore.exceptions import ClientError
from mypy_boto3_dynamodb.service_resource import Table

T = TypeVar("T")

_resource: Any = None


def _get_resource() -> Any:
    global _resource  # noqa: PLW0603
    if _resource is None:
        _resource = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "ap-northeast-2"))
    return _resource


class DynamoTable:
    """Type-safe wrapper around a DynamoDB table resource."""

    def __init__(self, table_name: str) -> None:
        self._table: Table = _get_resource().Table(table_name)
        self.table_name = table_name

    def get(self, pk: str, sk: str = "METADATA") -> dict[str, Any] | None:
        resp = self._table.get_item(Key={"PK": pk, "SK": sk})
        return resp.get("Item")

    def put(self, item: dict[str, Any]) -> None:
        self._table.put_item(Item=item)

    def put_if_not_exists(self, item: dict[str, Any]) -> bool:
        """Returns True if inserted, False if already existed."""
        try:
            self._table.put_item(
                Item=item,
                ConditionExpression="attribute_not_exists(PK)",
            )
            return True
        except ClientError as e:
            if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                return False
            raise

    def update(
        self,
        pk: str,
        sk: str,
        update_expression: str,
        expression_values: dict[str, Any],
        expression_names: dict[str, str] | None = None,
        condition: ConditionBase | None = None,
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "Key": {"PK": pk, "SK": sk},
            "UpdateExpression": update_expression,
            "ExpressionAttributeValues": expression_values,
            "ReturnValues": "ALL_NEW",
        }
        if expression_names:
            kwargs["ExpressionAttributeNames"] = expression_names
        if condition:
            kwargs["ConditionExpression"] = condition

        resp = self._table.update_item(**kwargs)
        return resp.get("Attributes", {})

    def delete(self, pk: str, sk: str = "METADATA") -> None:
        self._table.delete_item(Key={"PK": pk, "SK": sk})

    def query(
        self,
        key_condition: ConditionBase,
        filter_condition: ConditionBase | None = None,
        index_name: str | None = None,
        limit: int | None = None,
        last_evaluated_key: dict[str, Any] | None = None,
        scan_index_forward: bool = True,
        expression_names: dict[str, str] | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        kwargs: dict[str, Any] = {
            "KeyConditionExpression": key_condition,
            "ScanIndexForward": scan_index_forward,
        }
        if filter_condition:
            kwargs["FilterExpression"] = filter_condition
        if index_name:
            kwargs["IndexName"] = index_name
        if limit:
            kwargs["Limit"] = limit
        if last_evaluated_key:
            kwargs["ExclusiveStartKey"] = last_evaluated_key
        if expression_names:
            kwargs["ExpressionAttributeNames"] = expression_names

        resp = self._table.query(**kwargs)
        return resp.get("Items", []), resp.get("LastEvaluatedKey")

    def query_all(
        self,
        key_condition: ConditionBase,
        filter_condition: ConditionBase | None = None,
        index_name: str | None = None,
        scan_index_forward: bool = True,
    ) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        last_key: dict[str, Any] | None = None

        while True:
            batch, last_key = self.query(
                key_condition=key_condition,
                filter_condition=filter_condition,
                index_name=index_name,
                last_evaluated_key=last_key,
                scan_index_forward=scan_index_forward,
            )
            items.extend(batch)
            if not last_key:
                break

        return items
