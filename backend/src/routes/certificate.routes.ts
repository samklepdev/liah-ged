import { Router } from 'express';
import * as certificate from '../controllers/certificate.controller.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';

export const certificateRouter = Router();

certificateRouter.get('/certificates/me', requireAuth, certificate.getMine);
certificateRouter.get('/certificates/:id/download', requireAuth, certificate.download);
certificateRouter.get('/certificates/verify/:verificationId', certificate.verify);
