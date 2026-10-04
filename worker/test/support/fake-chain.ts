import {
  Keypair,
  PublicKey,
  SendTransactionError,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  type AccountInfo,
  type Connection,
  type SignatureStatus,
} from '@solana/web3.js';
import {
  ACCOUNT_SIZE,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AccountLayout,
  AccountState,
  MINT_SIZE,
  MintLayout,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  decodeTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import bs58 from 'bs58';

export const ATA_RENT = 2_039_280;

export interface SentTransfer {
  signature: string;
  owner: string;
  mint: string;
  amount: bigint;
  programId: string;
}

/**
 * An in-memory Solana bank behind the subset of `Connection` the engine
 * uses. Mints and token accounts are stored with the real SPL / Token-2022
 * binary layouts, and legacy transactions are decoded and applied — ATA
 * creation and transferChecked move real (fake) balances — so tests exercise
 * the exact instructions the engine builds.
 */
export class FakeChain {
  rpcEndpoint = 'http://fake-rpc.local';
  accounts = new Map<string, AccountInfo<Buffer>>();
  lamports = new Map<string, number>();
  statuses = new Map<string, SignatureStatus>();
  transfers: SentTransfer[] = [];
  sent: string[] = [];
  slot = 1_000;
  blockHeight = 900;
  genesisHash = 'LocalGenesis1111111111111111111111111111111';
  journal: string[] = [];

  /** Throw from sendRawTransaction (before or after "landing"). */
  onSend: ((signature: string) => 'land' | 'reject' | 'fail' | 'drop-after-landing' | 'lost') | null = null;
  /** Handles a PumpPortal VersionedTransaction: mutate balances here. */
  onVersioned: ((tx: VersionedTransaction) => void) | null = null;

  createMint(opts: { decimals: number; supply?: bigint; token2022?: boolean; address?: PublicKey }): { mint: PublicKey; programId: PublicKey } {
    const mint = opts.address ?? Keypair.generate().publicKey;
    const programId = opts.token2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const data = Buffer.alloc(MINT_SIZE);
    MintLayout.encode(
      {
        mintAuthorityOption: 0,
        mintAuthority: PublicKey.default,
        supply: opts.supply ?? 1_000_000_000_000_000n,
        decimals: opts.decimals,
        isInitialized: true,
        freezeAuthorityOption: 0,
        freezeAuthority: PublicKey.default,
      },
      data,
    );
    this.accounts.set(mint.toBase58(), { data, owner: programId, lamports: 1_461_600, executable: false, rentEpoch: 0 });
    return { mint, programId };
  }

  /** Sets a token balance. `ata: false` makes an extra, non-associated account. */
  setTokenBalance(mint: PublicKey, owner: PublicKey, amount: bigint, opts: { ata?: boolean; frozen?: boolean } = {}): PublicKey {
    const programId = this.accounts.get(mint.toBase58())!.owner;
    const address = opts.ata === false ? Keypair.generate().publicKey : getAssociatedTokenAddressSync(mint, owner, true, programId);
    const data = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode(
      {
        mint,
        owner,
        amount,
        delegateOption: 0,
        delegate: PublicKey.default,
        state: opts.frozen ? AccountState.Frozen : AccountState.Initialized,
        isNativeOption: 0,
        isNative: 0n,
        delegatedAmount: 0n,
        closeAuthorityOption: 0,
        closeAuthority: PublicKey.default,
      },
      data,
    );
    this.accounts.set(address.toBase58(), { data, owner: programId, lamports: ATA_RENT, executable: false, rentEpoch: 0 });
    return address;
  }

  tokenBalance(mint: PublicKey, owner: PublicKey): bigint {
    const programId = this.accounts.get(mint.toBase58())!.owner;
    const info = this.accounts.get(getAssociatedTokenAddressSync(mint, owner, true, programId).toBase58());
    return info ? AccountLayout.decode(info.data).amount : 0n;
  }

  setSol(owner: PublicKey, lamports: number): void {
    this.lamports.set(owner.toBase58(), lamports);
  }

  sol(owner: PublicKey): number {
    return this.lamports.get(owner.toBase58()) ?? 0;
  }

  // --- Connection surface -----------------------------------------------------

  asConnection(): Connection {
    return this as unknown as Connection;
  }

  async getGenesisHash() {
    return this.genesisHash;
  }
  async getSlot() {
    return this.slot;
  }
  async getBlockHeight() {
    return this.blockHeight;
  }
  async getLatestBlockhash() {
    return { blockhash: bs58.encode(Buffer.alloc(32, this.blockHeight % 250)), lastValidBlockHeight: this.blockHeight + 150 };
  }
  async getMinimumBalanceForRentExemption(size: number) {
    return size === 0 ? 890_880 : ATA_RENT + (size - ACCOUNT_SIZE) * 6_960;
  }
  async getBalance(key: PublicKey) {
    return this.sol(key);
  }
  async getAccountInfo(key: PublicKey) {
    return this.accounts.get(key.toBase58()) ?? null;
  }
  async getMultipleAccountsInfo(keys: PublicKey[]) {
    return keys.map((key) => this.accounts.get(key.toBase58()) ?? null);
  }
  async getTokenAccountBalance(key: PublicKey) {
    const info = this.accounts.get(key.toBase58());
    if (!info) throw new Error('could not find account');
    const amount = AccountLayout.decode(info.data).amount;
    return { context: { slot: this.slot }, value: { amount: amount.toString(), decimals: 0, uiAmount: null } };
  }
  async getProgramAccounts(programId: PublicKey, config: { filters: Array<{ memcmp: { offset: number; bytes: string } }> }) {
    this.journal.push(`gpa:${programId.toBase58()}`);
    const mint = bs58.decode(config.filters[0]!.memcmp.bytes);
    return [...this.accounts.entries()]
      .filter(([, info]) => info.owner.equals(programId) && info.data.length >= ACCOUNT_SIZE && info.data.subarray(0, 32).equals(Buffer.from(mint)))
      .map(([key, account]) => ({ pubkey: new PublicKey(key), account }));
  }
  async getSignatureStatuses(signatures: string[]) {
    return { context: { slot: this.slot }, value: signatures.map((sig) => this.statuses.get(sig) ?? null) };
  }

  async sendRawTransaction(raw: Buffer | Uint8Array) {
    const tx = Transaction.from(raw);
    const signature = bs58.encode(tx.signature!);
    this.journal.push(`broadcast:${signature}`);
    const mode = this.onSend?.(signature) ?? 'land';
    if (mode === 'reject') {
      throw new SendTransactionError({ action: 'send', signature, transactionMessage: 'Simulation failed', logs: ['Program log: rejected'] });
    }
    if (mode === 'fail') {
      this.statuses.set(signature, { slot: this.slot, confirmations: 1, err: { InstructionError: [1, 'Custom'] }, confirmationStatus: 'confirmed' });
      this.sent.push(signature);
      return signature;
    }
    if (mode === 'lost') throw new Error('fetch failed: socket hang up');
    this.apply(tx, signature);
    if (mode === 'drop-after-landing') throw new Error('fetch failed: connection reset');
    return signature;
  }

  async confirmTransaction(strategy: { signature: string }) {
    const status = this.statuses.get(strategy.signature);
    if (!status) throw new Error(`block height exceeded for ${strategy.signature}`);
    return { context: { slot: this.slot }, value: { err: status.err } };
  }

  async sendTransaction(tx: VersionedTransaction) {
    const signature = bs58.encode(tx.signatures[0]!);
    this.journal.push(`versioned:${signature}`);
    this.onVersioned?.(tx);
    this.statuses.set(signature, { slot: this.slot, confirmations: 1, err: null, confirmationStatus: 'confirmed' });
    return signature;
  }

  /** Applies ATA creation and transferChecked; anything else is ignored. */
  private apply(tx: Transaction, signature: string): void {
    const payer = tx.feePayer!;
    this.setSol(payer, this.sol(payer) - 5_000);
    for (const ix of tx.instructions) {
      if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
        const [, ata, owner, mint] = ix.keys.map((k) => k.pubkey);
        if (!this.accounts.has(ata!.toBase58())) {
          this.setTokenBalance(mint!, owner!, 0n);
          this.setSol(payer, this.sol(payer) - ATA_RENT);
        }
      } else if (ix.programId.equals(TOKEN_PROGRAM_ID) || ix.programId.equals(TOKEN_2022_PROGRAM_ID)) {
        const decoded = decodeTransferCheckedInstruction(ix, ix.programId);
        const { source, mint, destination } = decoded.keys;
        const amount = decoded.data.amount;
        const src = AccountLayout.decode(this.accounts.get(source.pubkey.toBase58())!.data);
        const dst = AccountLayout.decode(this.accounts.get(destination.pubkey.toBase58())!.data);
        if (src.amount < amount) throw new Error('insufficient funds');
        this.setTokenBalance(mint.pubkey, src.owner, src.amount - amount);
        this.setTokenBalance(mint.pubkey, dst.owner, dst.amount + amount);
        this.transfers.push({ signature, owner: dst.owner.toBase58(), mint: mint.pubkey.toBase58(), amount, programId: ix.programId.toBase58() });
      } else if (!ix.programId.equals(SystemProgram.programId) && ix.programId.toBase58() !== 'ComputeBudget111111111111111111111111111111') {
        throw new Error(`unexpected program ${ix.programId.toBase58()}`);
      }
    }
    this.sent.push(signature);
    this.statuses.set(signature, { slot: this.slot, confirmations: 1, err: null, confirmationStatus: 'confirmed' });
  }
}

/** An off-curve address, like a pool or a bonding curve. */
export function pda(seed: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(seed)], SystemProgram.programId)[0];
}
