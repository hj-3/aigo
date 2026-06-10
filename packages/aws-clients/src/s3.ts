import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Config } from './config.js';

let _client: S3Client | undefined;

export function getS3Client(): S3Client {
  if (!_client) {
    _client = new S3Client({ region: Config.region });
  }
  return _client;
}

export async function s3GetObject(
  bucket: string,
  key: string,
): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await getS3Client().send(cmd);
  if (!response.Body) throw new Error(`S3 object not found: s3://${bucket}/${key}`);
  return await response.Body.transformToString('utf-8');
}

export async function s3PutObject(
  bucket: string,
  key: string,
  body: string | Buffer,
  contentType = 'application/json',
): Promise<void> {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ServerSideEncryption: 'aws:kms',
    }),
  );
}

export async function s3DeleteObject(bucket: string, key: string): Promise<void> {
  await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function s3ObjectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function s3GetSignedUrl(
  bucket: string,
  key: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(getS3Client(), cmd, { expiresIn: expiresInSeconds });
}

export async function s3UploadLargeObject(
  bucket: string,
  key: string,
  body: NodeJS.ReadableStream | Buffer,
  contentType = 'application/octet-stream',
): Promise<void> {
  const upload = new Upload({
    client: getS3Client(),
    params: {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ServerSideEncryption: 'aws:kms',
    },
  });
  await upload.done();
}

export { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, CopyObjectCommand };
