import { certificatesApi, type CertificateStatus } from './api';

export function CertificateCard({ status }: { status: CertificateStatus }) {
  if (status.status === 'issued') {
    const { certificate } = status;
    return (
      <div className="cert-card cert-card-issued">
        <span className="brand-seal cert-card-seal" aria-hidden="true">
          LH
        </span>
        <div>
          <h3>Diploma Certificate</h3>
          <p>
            Verification ID: <code>{certificate.verificationId}</code>
          </p>
          <a className="cert-card-download" href={certificatesApi.downloadUrl(certificate.id)}>
            Download certificate
          </a>
        </div>
      </div>
    );
  }

  const label =
    status.remainingCourses === 1
      ? '1 subject remaining'
      : `${status.remainingCourses} subjects remaining`;

  return (
    <div className="cert-card cert-card-locked">
      <span className="brand-seal cert-card-seal" aria-hidden="true">
        LH
      </span>
      <div>
        <h3>Diploma Certificate</h3>
        <p>{label} before your certificate unlocks.</p>
      </div>
    </div>
  );
}
