import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
let client: S3Client | undefined;
function storage() {
  if (!process.env.AWS_ENDPOINT_URL_S3 || !process.env.AWS_SECRET_ACCESS_KEY)
    throw new Error('Private file storage is not configured.');
  return client ??= new S3Client({ endpoint: process.env.AWS_ENDPOINT_URL_S3,
    region: process.env.AWS_REGION, forcePathStyle: true });
}
const bucketName = () => process.env.SESSION_FILES_BUCKET || 'session-files';
export const privateBucket = {
  async put(key: string, body: ReadableStream | ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string } }) {
    const bytes = body instanceof ReadableStream
      ? new Uint8Array(await new Response(body).arrayBuffer())
      : body instanceof ArrayBuffer ? new Uint8Array(body) : body;
    await storage().send(new PutObjectCommand({ Bucket: bucketName(), Key: key, Body: bytes,
      ContentType: options?.httpMetadata?.contentType, CacheControl: 'private, no-store' }));
  },
  async get(key: string, options?: { range?: { offset: number; length: number } }) {
    const range = options?.range;
    try {
      const result = await storage().send(new GetObjectCommand({ Bucket: bucketName(), Key: key,
        Range: range ? `bytes=${range.offset}-${range.offset + range.length - 1}` : undefined }));
      return result.Body ? { body: result.Body.transformToWebStream(), size: result.ContentLength,
        arrayBuffer: async () => (await result.Body!.transformToByteArray()).buffer } : null;
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  },
  async delete(key: string | string[]) {
    for (const id of Array.isArray(key) ? key : [key])
      await storage().send(new DeleteObjectCommand({ Bucket: bucketName(), Key: id }));
  },
};
