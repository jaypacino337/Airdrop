import { ImageResponse } from 'next/og';
import { cycleMinutes, maxWalletSharePct, rewardList, siteConfig } from '@/lib/config';

export const alt = `${siteConfig.name} — hold ${siteConfig.ticker}, get paid in uranium`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Social card in the survey-terminal style: graphite, yellowcake, hazard tape. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0c0d09',
          color: '#edefe2',
          fontFamily: 'monospace',
        }}
      >
        <div style={{ height: 18, display: 'flex', background: 'repeating-linear-gradient(-45deg, #f2c400 0 28px, #14130a 28px 56px)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', padding: '0 80px' }}>
          <div style={{ display: 'flex', fontSize: 28, letterSpacing: 6, color: '#98a186' }}>
            {`${siteConfig.name.toUpperCase()} · $${siteConfig.ticker} · SOLANA`}
          </div>
          <div style={{ display: 'flex', fontSize: 84, fontWeight: 700, marginTop: 24, lineHeight: 1.05 }}>
            {`HOLD ${siteConfig.ticker}.`}
          </div>
          <div style={{ display: 'flex', fontSize: 84, fontWeight: 700, color: '#ffd23d', lineHeight: 1.05 }}>
            GET PAID IN URANIUM.
          </div>
          <div style={{ display: 'flex', fontSize: 30, marginTop: 36, color: '#98a186' }}>
            {`${rewardList} airdropped every ${cycleMinutes} min · ${maxWalletSharePct}% per-wallet cap`}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 80px 48px', fontSize: 24, color: '#7fdd8b' }}>
          <div style={{ width: 14, height: 14, borderRadius: 7, background: '#7fdd8b', display: 'flex' }} />
          REACTOR LIVE · PUMP.FUN CREATOR FEES → HOLDERS
        </div>
      </div>
    ),
    size,
  );
}
