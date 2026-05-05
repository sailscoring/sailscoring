import { z } from 'zod';

export const feedbackInputSchema = z.object({
  message: z.string().trim().min(1, 'Message is required').max(5000),
  pageUrl: z.string().url().max(2048),
});

export type FeedbackInput = z.infer<typeof feedbackInputSchema>;
