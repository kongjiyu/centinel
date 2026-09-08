type IllustrationProps = { className?: string };

export function ReviewIllustration({ className }: IllustrationProps) {
  return (
    <svg className={className} viewBox="0 0 180 120" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false">
      <path d="M25 38.5h47l10 10h68v45H25v-55Z" fill="#E7F1E6" stroke="#6D9675" strokeWidth="2" strokeLinejoin="round" />
      <path d="M25 38.5h47l10 10H25v-10Z" fill="#C9E1C9" stroke="#6D9675" strokeWidth="2" strokeLinejoin="round" />
      <rect x="78" y="19" width="68" height="68" rx="5" fill="#fff" stroke="#28623C" strokeWidth="2" />
      <path d="M91 34h29M91 45h39M91 56h31" stroke="#B6C8B3" strokeWidth="3" strokeLinecap="round" />
      <path d="m91 70 4 4 8-9" stroke="#047857" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M111 71h19" stroke="#B6C8B3" strokeWidth="3" strokeLinecap="round" />
      <circle cx="149" cy="26" r="10" fill="#28623C" />
      <path d="m144.5 26 3 3 5.5-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StaticTestingIllustration({ className }: IllustrationProps) {
  return (
    <svg className={className} viewBox="0 0 144 104" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false">
      <rect x="27" y="22" width="69" height="64" rx="5" fill="#F7FBF6" stroke="#6D9675" strokeWidth="2" />
      <rect x="19" y="30" width="69" height="64" rx="5" fill="#E7F1E6" stroke="#6D9675" strokeWidth="2" />
      <rect x="35" y="14" width="69" height="64" rx="5" fill="#fff" stroke="#28623C" strokeWidth="2" />
      <path d="M48 29h26M48 39h38M48 49h28" stroke="#B6C8B3" strokeWidth="3" strokeLinecap="round" />
      <circle cx="53" cy="63" r="7" fill="#DEEEE0" stroke="#047857" strokeWidth="2" />
      <path d="m49.5 63 2.5 2.5 4.5-5" stroke="#047857" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="79" cy="63" r="7" fill="#FFF7E6" stroke="#9A5B00" strokeWidth="2" />
      <path d="M79 59v5" stroke="#9A5B00" strokeWidth="2" strokeLinecap="round" />
      <circle cx="79" cy="67" r="1" fill="#9A5B00" />
    </svg>
  );
}

export function DynamicTestingIllustration({ className }: IllustrationProps) {
  return (
    <svg className={className} viewBox="0 0 144 104" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false">
      <rect x="18" y="17" width="96" height="69" rx="7" fill="#F7FBF6" stroke="#2F8B78" strokeWidth="2" />
      <path d="M18 34h96" stroke="#2F8B78" strokeWidth="2" />
      <circle cx="31" cy="25.5" r="3" fill="#9ACCB5" />
      <circle cx="41" cy="25.5" r="3" fill="#9ACCB5" />
      <circle cx="51" cy="25.5" r="3" fill="#9ACCB5" />
      <rect x="31" y="47" width="46" height="7" rx="3.5" fill="#CFEAE2" />
      <rect x="31" y="62" width="29" height="7" rx="3.5" fill="#DEEEE0" />
      <path d="m88 50 19 33-12-7-7 13-5-3 7-13-13-1 11-22Z" fill="#0F766E" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="104" cy="45" r="14" fill="#E8F6F3" stroke="#2F8B78" strokeWidth="2" />
      <path d="m98 45 4 4 8-9" stroke="#0F766E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

