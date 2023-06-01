import { logger } from '../utils/logger'
import { APIGatewayProxyEvent } from 'aws-lambda'
import S3Client, { TransferFileInput } from '../infra/s3'

const s3Client = S3Client({ logger })
export const MultipartUploadsHandler = async (event: APIGatewayProxyEvent) => {
  try {
    logger.info({ message: 'MultipartUploadsHandler: A new request is arrived:', events: event })
    const transferFileInput = {
      sourceBucket: 'sourceBucketName',// any bucket name
      sourceFileKey: 'sourceFileKey', // yyyy/test.mov
      destinationBucket: 'destinationBucketName', // any bucket name
      destinationFileKey: 'destinationFileKey' // xxx/test.mov
    }
    return await s3Client.transferFile(transferFileInput)
  } catch (error) {
    logger.error({ message: 'Error While invoking MultipartUploadsHandler Handler:', error, event })
  }
}
