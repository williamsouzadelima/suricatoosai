const mockSend = jest.fn();

export const S3Client = jest.fn().mockImplementation((config: any) => ({
  send: mockSend,
}));

export const PutObjectCommand = jest.fn().mockImplementation((params: any) => ({
  params,
}));

export const CopyObjectCommand = jest
  .fn()
  .mockImplementation((params: any) => ({ params }));

export const GetObjectCommand = jest
  .fn()
  .mockImplementation((params: any) => ({ params }));

export class DeleteObjectCommand {
  constructor(params: any) {}
}

export class HeadObjectCommand {
  constructor(params: any) {}
}
