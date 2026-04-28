const AWS_URL_SCHEMES = {
  s3: "s3"
} as const;

export function buildS3Uri(bucket: string, key: string): string {
  return `${AWS_URL_SCHEMES.s3}://${bucket}/${key}`;
}
