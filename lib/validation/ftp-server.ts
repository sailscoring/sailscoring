import { z } from 'zod';

import type { FtpServer } from '@/lib/types';

import { uuidSchema, versionSchema } from './common';

export const ftpServerSchema = z.object({
  id: uuidSchema,
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  password: z.string(),
  ftps: z.boolean(),
  version: versionSchema,
});

export const ftpServerInputSchema = ftpServerSchema.extend({
  id: uuidSchema.optional(),
});

const _ftpFromZod: FtpServer = undefined as unknown as z.infer<typeof ftpServerSchema>;
const _ftpFromTs: z.infer<typeof ftpServerSchema> = undefined as unknown as FtpServer;
void _ftpFromZod;
void _ftpFromTs;
