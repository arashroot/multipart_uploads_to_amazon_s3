import * as AWS from 'aws-sdk'
import * as Winston from 'winston'

export interface TransferFileInput {
  sourceBucket: string
  sourceFileKey: string // file.mov
  destinationBucket: string
  destinationFileKey: string // folder/file.mov
  marker?: string
}

export interface MultipartUploadParams {
  Bucket: string,
  CopySource: string
  Key: string,
  PartNumber: number,
  UploadId: string,
  CopySourceRange: string
}

interface UploadFileInput {
  Bucket: string,
  Key: string,
  Body: string,
  ServerSideEncryption: string,
  ACL: string
}

export interface S3ClientInput {
  logger: Winston.Logger
}

export interface S3ClientOutPut {
  transferFile: (transferFileInput: TransferFileInput) => Promise<string>
  upload: (params: UploadFileInput) => Promise<string>
}

export default function S3Client(input: S3ClientInput): S3ClientOutPut {
  const { logger } = input
  const s3 = new AWS.S3({ apiVersion: '2006-03-01' })

  async function transferFile(transferFileInput: TransferFileInput): Promise<string> {
    try {
      logger.info({ message: 'Start transfer the file', TransferFile: transferFileInput })
      const { sourceBucket, destinationBucket, destinationFileKey, sourceFileKey } = transferFileInput
      const partsEtags = []
      let doneChunks = 0
      const sourceParams = {
        Bucket: sourceBucket,
        Key: sourceFileKey
      }
      const s3Object = await s3.headObject(sourceParams).promise()
      if (s3Object.ContentLength <= 0) {
        logger.error({ message: `No objects were found in the S3 bucket: ${ sourceBucket }`, s3Object })
        return
      }
      const partUpload = await createMultipartUpload(s3Object, destinationBucket, destinationFileKey, sourceParams)

      if (partUpload?.params.length > 1) {
        const result = await Promise.all(partUpload.params.map(async (p, index) => {
          const dataPartCopy = await s3.uploadPartCopy(p).promise()

          if (dataPartCopy && dataPartCopy?.CopyPartResult?.ETag) {
            partsEtags[index] = dataPartCopy.CopyPartResult.ETag
            doneChunks++
            return checkIfDone(dataPartCopy.CopyPartResult.ETag, partUpload.uploadId, index, doneChunks, partUpload.total_chunks, partsEtags, destinationBucket, destinationFileKey)
          }
        }))
        return result.filter(i => i === 'Success')[0]
      }
      // if we have just one chunk we can copy the file directly
      if (partUpload?.params.length === 1) {
        const result = await s3.copyObject({
          Bucket: partUpload?.params[0].Bucket,
          CopySource: partUpload?.params[0].CopySource,
          Key: partUpload?.params[0].Key,
          ServerSideEncryption: 'AES256',
          ACL: 'public-read'
        }).promise()

        if (!result.$response.error) {
          return 'Success'
        }
      }
    } catch (error) {
      logger.error({ message: 'Error While invoking transferFile:', error })
    }
  }

  async function createMultipartUpload(s3Object: AWS.S3.Types.HeadObjectOutput, destinationBucket: string, destinationFileKey: string, sourceParams: { Bucket: string, Key: string }): Promise<{ params: MultipartUploadParams[], uploadId: string, total_chunks: number }> {
    try {
      logger.info({ message: 'Initiating the process of creating a multipart file upload' })
      const totalSize = s3Object.ContentLength
      const params: MultipartUploadParams[] = []
      const maxChunkSize = (s3Object.ContentLength > 1000000000) ? 1000000000 : 5 * 1024 * 1024
      const destinationParams = {
        Bucket: destinationBucket,
        Key: destinationFileKey,
        ServerSideEncryption: 'AES256',
        ACL: 'public-read'
      }
      const multipartUpload = await s3.createMultipartUpload(destinationParams).promise()

      const totalChunks = Math.floor(totalSize / maxChunkSize)
      const remainerChunk = totalSize % maxChunkSize

      for (let i = 0; i <= totalChunks; i++) {
        const chunk = createChunk(i, totalChunks, maxChunkSize, remainerChunk)
        params.push({
          Bucket: destinationBucket,
          CopySource: sourceParams.Bucket + '/' + sourceParams.Key,
          Key: destinationFileKey,
          PartNumber: i + 1,
          UploadId: multipartUpload.UploadId,
          CopySourceRange: chunk
        })
      }
      return { params, uploadId: multipartUpload.UploadId, total_chunks: totalChunks }

    } catch (error) {
      logger.error({
        message: 'An error occurred while attempting to initiate a multipart file upload.',
        error,
        destinationBucket,
        destinationFileKey
      })
    }

  }

  function createChunk(i: number, totalChunks: number, maxChunkSize: number, remainedChunk: number): string {
    if (i === 0)
      return `bytes=${ (i * maxChunkSize) }-${ (((i + 1) * maxChunkSize)) }`
    else if (i === totalChunks)
      return `bytes=${ ((i * maxChunkSize) + 1) }-${ ((i * maxChunkSize) + remainedChunk - 1) }`
    else
      return `bytes=${ ((i * maxChunkSize) + 1) }-${ (((i + 1) * maxChunkSize)) }`
  }

  async function checkIfDone(etag: string, uploadId: string, partId: number, doneChunks: number, totalChunks: number,
                             partsEtags: string[], destinationBucket: string, destinationKey: string): Promise<string> {
    if (doneChunks > totalChunks) {
      logger.info({ message: 'All chunks done' })
      const etagsParams = partsEtags.map((partsEtag, i) => {
        return {
          ETag: partsEtag,
          PartNumber: i + 1
        }
      })
      const params = {
        Bucket: destinationBucket,
        Key: destinationKey,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: etagsParams
        },
        RequestPayer: 'requester'
      }
      const result = await s3.completeMultipartUpload(params).promise()

      if (result.$response.error) {
        return 'false'
      }
      return 'Success'
    }
    return 'pending'
  }

  async function upload(params: UploadFileInput): Promise<string> {
    try {
      logger.info({ message: 'Initiating the process of uploading the file to the S3 bucket', params })
      const result = await s3.upload(params).promise()
      return result.Location
    } catch (error) {
      logger.error({ message: 'An error occurred while attempting to upload the file to S3 bucket', error, params })
    }
  }

  return { transferFile, upload }
}
