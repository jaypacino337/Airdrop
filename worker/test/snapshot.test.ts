import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { takeHolderSnapshot } from '../src/chain/snapshot.js';
import { INCINERATOR, pumpBondingCurve, resolveToken } from '../src/chain/solana.js';
import { FakeChain, pda } from './support/fake-chain.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function scenario(token2022 = false) {
  const chain = new FakeChain();
  const { mint } = chain.createMint({ decimals: 6, token2022 });
  const alice = Keypair.generate().publicKey;
  const bob = Keypair.generate().publicKey;
  const frozen = Keypair.generate().publicKey;
  const empty = Keypair.generate().publicKey;
  const pool = pda('pumpswap-pool');

  chain.setTokenBalance(mint, alice, 400_000_000_000n); // 400k tokens in her ATA…
  chain.setTokenBalance(mint, alice, 200_000_000_000n, { ata: false }); // …plus 200k in a second account
  chain.setTokenBalance(mint, bob, 1_000_000_000_000n);
  chain.setTokenBalance(mint, frozen, 9_000_000_000_000n, { frozen: true });
  chain.setTokenBalance(mint, empty, 0n);
  chain.setTokenBalance(mint, pool, 50_000_000_000_000n);
  chain.setTokenBalance(mint, pumpBondingCurve(mint), 700_000_000_000_000n);
  chain.setTokenBalance(mint, new PublicKey(INCINERATOR), 5_000_000_000n);

  // A different mint's holder must never leak into this snapshot.
  const other = chain.createMint({ decimals: 6, token2022 }).mint;
  chain.setTokenBalance(other, Keypair.generate().publicKey, 123n);

  return { chain, mint, alice, bob, pool };
}

test('getProgramAccounts scan: sums per owner, skips frozen/empty, excludes PDAs, curve and burn', async () => {
  const { chain, mint, alice, bob } = scenario();
  const token = await resolveToken(chain.asConnection(), mint.toBase58());
  assert.ok(token.programId.equals(TOKEN_PROGRAM_ID));
  assert.equal(token.decimals, 6);

  const snap = await takeHolderSnapshot(chain.asConnection(), { token });

  assert.equal(snap.source, 'rpc');
  assert.equal(snap.slot, chain.slot);
  assert.deepEqual(
    snap.holders.map((h) => [h.owner, h.balanceRaw]),
    [
      [bob.toBase58(), 1_000_000_000_000n],
      [alice.toBase58(), 600_000_000_000n],
    ],
  );
  // pool PDA + bonding curve + incinerator
  assert.equal(snap.excludedCount, 3);
  assert.deepEqual(chain.journal, [`gpa:${TOKEN_PROGRAM_ID.toBase58()}`]);
});

test('Token-2022 mints are scanned under the Token-2022 program', async () => {
  const { chain, mint, alice, bob } = scenario(true);
  const token = await resolveToken(chain.asConnection(), mint.toBase58());
  assert.ok(token.programId.equals(TOKEN_2022_PROGRAM_ID));

  const snap = await takeHolderSnapshot(chain.asConnection(), { token });
  assert.deepEqual(snap.holders.map((h) => h.owner).sort(), [alice.toBase58(), bob.toBase58()].sort());
  assert.deepEqual(chain.journal, [`gpa:${TOKEN_2022_PROGRAM_ID.toBase58()}`]);
});

test('EXCLUDE_CONTRACT_HOLDERS=false keeps PDA owners (the curve and burn stay out)', async () => {
  const { chain, mint, pool } = scenario();
  const token = await resolveToken(chain.asConnection(), mint.toBase58());
  const snap = await takeHolderSnapshot(chain.asConnection(), { token, excludePdas: false });
  assert.ok(snap.holders.some((h) => h.owner === pool.toBase58()));
  assert.ok(!snap.holders.some((h) => h.owner === pumpBondingCurve(mint).toBase58()));
  assert.ok(!snap.holders.some((h) => h.owner === INCINERATOR));
});

test('refuses to scan through the public mainnet endpoint', async () => {
  const { chain, mint } = scenario();
  const token = await resolveToken(chain.asConnection(), mint.toBase58());
  chain.rpcEndpoint = 'https://api.mainnet-beta.solana.com';
  await assert.rejects(takeHolderSnapshot(chain.asConnection(), { token }), /dedicated RPC/);
});

test('resolveToken refuses an address that is not a mint', async () => {
  const chain = new FakeChain();
  const wallet = Keypair.generate().publicKey;
  await assert.rejects(resolveToken(chain.asConnection(), wallet.toBase58()), /not found/);
  const { mint } = chain.createMint({ decimals: 6 });
  const account = chain.setTokenBalance(mint, wallet, 1n);
  chain.accounts.get(account.toBase58())!.owner = new PublicKey('11111111111111111111111111111111');
  await assert.rejects(resolveToken(chain.asConnection(), account.toBase58()), /not a token mint/);
});

test('Helius path: paginates with a cursor, keeps amounts above 2^53 exact, skips frozen', async () => {
  const chain = new FakeChain();
  const { mint } = chain.createMint({ decimals: 9 });
  const token = await resolveToken(chain.asConnection(), mint.toBase58());
  const whale = Keypair.generate().publicKey.toBase58();
  const small = Keypair.generate().publicKey.toBase58();
  const frozen = Keypair.generate().publicKey.toBase58();

  const bodies: Array<{ params: { mint: string; cursor?: string } }> = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    // Raw JSON so the huge number is a JSON number, exactly as Helius sends it.
    const text = body.params.cursor
      ? `{"result":{"token_accounts":[{"owner":"${small}","amount":5000},{"owner":"${frozen}","amount":7,"frozen":true}]}}`
      : `{"result":{"token_accounts":[{"owner":"${whale}","amount":12345678901234567891}],"cursor":"page-2"}}`;
    return new Response(text, { status: 200 });
  }) as typeof fetch;

  const snap = await takeHolderSnapshot(chain.asConnection(), { token, heliusApiKey: 'k', heliusUrl: 'https://helius.test' });
  assert.equal(snap.source, 'helius');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0]!.params.mint, mint.toBase58());
  assert.equal(bodies[1]!.params.cursor, 'page-2');
  assert.deepEqual(
    snap.holders.map((h) => [h.owner, h.balanceRaw]),
    [
      [whale, 12_345_678_901_234_567_891n],
      [small, 5_000n],
    ],
  );
});
