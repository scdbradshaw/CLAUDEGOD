import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/** Express middleware factory: validates req.body against a Zod schema */
export function validate<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error:   'Validation failed',
        details: formatZodError(result.error),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

function formatZodError(err: ZodError) {
  return err.issues.map((issue) => ({
    path:    issue.path.join('.'),
    message: issue.message,
  }));
}
