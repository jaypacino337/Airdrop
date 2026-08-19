/**
 * A flat city silhouette, echoing the banner artwork. Purely decorative: it
 * inherits currentColor so pages can tint it as faintly as they like.
 */
export function Skyline({ className, ...rest }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 1440 160" preserveAspectRatio="none" className={className} {...rest}>
      <path
        fill="currentColor"
        d="M0 160V96h34V72h26v24h30V54h20v42h28V78h34v18h22V40h16v56h30V66h26v30h24V84h30v12h22V28h14v68h26V60h28v36h24V74h32v22h20V46h18v50h28V80h30v16h24V58h26v38h22V88h34v8h24V36h16v60h26V70h30v26h22V82h28v14h24V50h20v46h28V76h32v20h22V62h24v34h26V86h30v10h24V44h18v52h26V72h28v24h24V84h32v12h20V54h22v42h28V78h26v18h24V64h30v32h22V88h28v8h26V70h24v26h20V52h30v44h26V80h22v16h30V60h24v36h26V86h24v10h30V74h20v22h26V90h34v6h24v64z"
      />
    </svg>
  );
}
