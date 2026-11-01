type IllustrationProps = { className?: string };

export function ReviewIllustration({ className }: IllustrationProps) {
  return (
    <svg className={className} viewBox="0 0 180 120" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false">
      <path d="M25 38.5h47l10 10h68v45H25v-55Z" fill="#F0FDF4" stroke="#A8A29E" strokeWidth="2" strokeLinejoin="round" />
      <path d="M25 38.5h47l10 10H25v-10Z" fill="#E7E5E4" stroke="#A8A29E" strokeWidth="2" strokeLinejoin="round" />
      <rect x="78" y="19" width="68" height="68" rx="5" fill="#fff" stroke="#166534" strokeWidth="2" />
      <path d="M91 34h29M91 45h39M91 56h31" stroke="#D6D3D1" strokeWidth="3" strokeLinecap="round" />
      <path d="m91 70 4 4 8-9" stroke="#15803D" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M111 71h19" stroke="#D6D3D1" strokeWidth="3" strokeLinecap="round" />
      <circle cx="149" cy="26" r="10" fill="#166534" />
      <path d="m144.5 26 3 3 5.5-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StaticTestingIllustration({ className }: IllustrationProps) {
  return (
    <svg className={className} viewBox="0 0 144 104" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false">
      <rect x="27" y="22" width="69" height="64" rx="5" fill="#FAFAF9" stroke="#A8A29E" strokeWidth="2" />
      <rect x="19" y="30" width="69" height="64" rx="5" fill="#F0FDF4" stroke="#A8A29E" strokeWidth="2" />
      <rect x="35" y="14" width="69" height="64" rx="5" fill="#fff" stroke="#166534" strokeWidth="2" />
      <path d="M48 29h26M48 39h38M48 49h28" stroke="#D6D3D1" strokeWidth="3" strokeLinecap="round" />
      <circle cx="53" cy="63" r="7" fill="#DCFCE7" stroke="#15803D" strokeWidth="2" />
      <path d="m49.5 63 2.5 2.5 4.5-5" stroke="#15803D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="79" cy="63" r="7" fill="#FFFBEB" stroke="#B45309" strokeWidth="2" />
      <path d="M79 59v5" stroke="#B45309" strokeWidth="2" strokeLinecap="round" />
      <circle cx="79" cy="67" r="1" fill="#B45309" />
    </svg>
  );
}

export function DynamicTestingIllustration({ className }: IllustrationProps) {
  return (
    <svg className={className} viewBox="0 0 144 104" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false">
      <rect x="18" y="17" width="96" height="69" rx="7" fill="#FAFAF9" stroke="#16A34A" strokeWidth="2" />
      <path d="M18 34h96" stroke="#16A34A" strokeWidth="2" />
      <circle cx="31" cy="25.5" r="3" fill="#86EFAC" />
      <circle cx="41" cy="25.5" r="3" fill="#86EFAC" />
      <circle cx="51" cy="25.5" r="3" fill="#86EFAC" />
      <rect x="31" y="47" width="46" height="7" rx="3.5" fill="#DCFCE7" />
      <rect x="31" y="62" width="29" height="7" rx="3.5" fill="#DCFCE7" />
      <path d="m88 50 19 33-12-7-7 13-5-3 7-13-13-1 11-22Z" fill="#0F766E" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="104" cy="45" r="14" fill="#F0FDFA" stroke="#16A34A" strokeWidth="2" />
      <path d="m98 45 4 4 8-9" stroke="#0F766E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

