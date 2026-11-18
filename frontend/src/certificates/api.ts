import { request } from '../lib/apiClient';

export type CertificateStatus =
  | { status: 'locked'; remainingCourses: number; totalCourses: number }
  | {
      status: 'issued';
      certificate: { id: string; verificationId: string; issuedAt: string };
    };

export const certificatesApi = {
  getMine: () => request<CertificateStatus>('/certificates/me'),
  downloadUrl: (certificateId: string) => `/api/v1/certificates/${certificateId}/download`,
};
