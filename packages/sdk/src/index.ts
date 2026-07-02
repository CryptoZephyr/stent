/**
 * StentClient — a thin, agent-friendly wrapper around Circle Gateway's
 * `GatewayClient` (`@circle-fin/x402-batching`).
 *
 * It adds the two things an autonomous agent actually needs on top of raw
 * `pay()`:
 *   1. A hard spend cap enforced *before* any payment authorization is signed.
 *   2. Running spend accounting (`getSpendSummary()`), so an agent loop can
 *      reason about its remaining budget.
 *
 * Everything else (402 detection, EIP-3009 signing against the GatewayWallet,
 * retry with the payment header, batched gas-free settlement) is handled by the
 * underlying GatewayClient.
 *
 * @example
 * ```ts
 * const client = new StentClient({
 *   privateKey: process.env.BUYER_PRIVATE_KEY as `0x${string}`,
 *   spendCapUsdc: 1.0,
 * });
 * const data = await client.fetch("https://api.stent.xyz/arc-stats");
 * ```
 */
import { GatewayClient, type SupportedChainName } from "@circle-fin/x402-batching/client";
import { formatUnits, parseUnits, type Hex } from "viem";

const USDC_DECIMALS = 6;

export interface StentClientConfig {
  /** Buyer/agent private key. Funds the Gateway balance used for payments. */
  privateKey: Hex;
  /** Gateway chain. Defaults to Arc testnet. */
  chain?: SupportedChainName;
  /** Optional custom RPC URL (only required for Arc *mainnet*). */
  rpcUrl?: string;
  /**
   * Maximum cumulative USDC this client may spend across its lifetime.
   * Defaults to Infinity (no cap). When set, any `fetch`/`pay` whose payment
   * would push total spend past the cap throws *before* signing.
   */
  spendCapUsdc?: number;
}

export interface StentFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
}

export interface SpendSummary {
  totalSpentUsdc: number;
  remainingCapUsdc: number;
  spendCapUsdc: number;
  paymentCount: number;
}

export interface StentPayResult<T = unknown> {
  data: T;
  /** Amount paid, in USDC atomic units (6 decimals). */
  amount: bigint;
  /** Amount paid, formatted as a decimal USDC string. */
  formattedAmount: string;
  /** Settlement transaction reference from the facilitator. */
  transaction: string;
  status: number;
}

/** Thrown when a payment would exceed the configured spend cap. */
export class SpendCapExceededError extends Error {
  constructor(
    readonly attemptedUsdc: number,
    readonly totalSpentUsdc: number,
    readonly spendCapUsdc: number
  ) {
    super(
      `Spend cap reached: this $${attemptedUsdc} payment would bring total to ` +
        `$${(totalSpentUsdc + attemptedUsdc).toFixed(6)}, over the $${spendCapUsdc} cap.`
    );
    this.name = "SpendCapExceededError";
  }
}

/**
 * Thrown when a payment fails and the Gateway balance is confirmed (via the
 * documented `getBalances()`/`supports()` APIs) to be below what the request
 * requires — as opposed to some other failure (network, signature, etc.).
 */
export class InsufficientGatewayBalanceError extends Error {
  constructor(
    readonly requiredUsdc: number,
    readonly availableUsdc: number
  ) {
    super(
      `Insufficient Gateway balance: this payment needs $${requiredUsdc.toFixed(6)} but only ` +
        `$${availableUsdc.toFixed(6)} is available. Get testnet USDC from ` +
        `https://faucet.circle.com, then fund the Gateway balance with ` +
        `client.deposit("<amount>") before paying.`
    );
    this.name = "InsufficientGatewayBalanceError";
  }
}

export class StentClient {
  private readonly gateway: GatewayClient;
  private readonly spendCapAtomic: bigint;
  private readonly spendCapUsdc: number;
  private totalSpentAtomic = 0n;
  private paymentCount = 0;
  /** Set by the abort hook so we can throw a typed error from fetch/pay. */
  private lastCapBlock: { attemptedAtomic: bigint } | null = null;

  constructor(config: StentClientConfig) {
    this.spendCapUsdc = config.spendCapUsdc ?? Infinity;
    this.spendCapAtomic =
      this.spendCapUsdc === Infinity
        ? -1n // sentinel: no cap
        : parseUnits(this.spendCapUsdc.toString(), USDC_DECIMALS);

    this.gateway = new GatewayClient({
      chain: config.chain ?? "arcTestnet",
      privateKey: config.privateKey,
      ...(config.rpcUrl ? { rpcUrl: config.rpcUrl } : {}),
    });

    // Enforce the spend cap before any authorization is signed. Returning
    // `{ abort: true }` makes the underlying `pay()` throw before sending.
    this.gateway.onBeforePaymentCreation(async (ctx: BeforePaymentCreationCtx) => {
      if (this.spendCapAtomic < 0n) return; // no cap
      const attempted = BigInt(ctx.selectedRequirements.amount);
      if (this.totalSpentAtomic + attempted > this.spendCapAtomic) {
        this.lastCapBlock = { attemptedAtomic: attempted };
        return { abort: true, reason: "spend_cap_exceeded" };
      }
      return;
    });
  }

  /** The agent's wallet address (payer). */
  get address(): string {
    return this.gateway.address;
  }

  /**
   * Pay for an x402-protected resource and return the parsed response body.
   * Convenience wrapper over {@link pay} for the common "just give me the data"
   * case used inside agent tools.
   */
  async fetch<T = unknown>(url: string, options?: StentFetchOptions): Promise<T> {
    const result = await this.pay<T>(url, options);
    return result.data;
  }

  /**
   * Pay for an x402-protected resource and return full payment metadata
   * (amount, settlement tx, status) alongside the data.
   *
   * @throws {SpendCapExceededError} if the payment would exceed the spend cap.
   * @throws {InsufficientGatewayBalanceError} if the payment fails and the
   *   Gateway balance is confirmed too low to cover it.
   */
  async pay<T = unknown>(url: string, options?: StentFetchOptions): Promise<StentPayResult<T>> {
    try {
      const res = await this.gateway.pay<T>(url, options);
      this.totalSpentAtomic += res.amount;
      this.paymentCount += 1;
      return {
        data: res.data,
        amount: res.amount,
        formattedAmount: res.formattedAmount,
        transaction: res.transaction,
        status: res.status,
      };
    } catch (err) {
      // Translate the generic abort thrown by the spend-cap hook into a typed,
      // actionable error for agent loops.
      if (this.lastCapBlock) {
        const attempted = Number(formatUnits(this.lastCapBlock.attemptedAtomic, USDC_DECIMALS));
        this.lastCapBlock = null;
        throw new SpendCapExceededError(
          attempted,
          Number(formatUnits(this.totalSpentAtomic, USDC_DECIMALS)),
          this.spendCapUsdc
        );
      }
      const balanceError = await this.diagnoseInsufficientBalance(url);
      if (balanceError) throw balanceError;
      throw err;
    }
  }

  /**
   * After a payment failure, use only documented APIs (`supports()`,
   * `getBalances()`) to check whether the Gateway balance was actually too
   * low to cover it. Returns `null` — never throws — when that can't be
   * confirmed, so the original error is what the caller sees.
   */
  private async diagnoseInsufficientBalance(url: string): Promise<InsufficientGatewayBalanceError | null> {
    try {
      const support = await this.gateway.supports(url);
      const requirements = support.requirements as { amount?: string } | undefined;
      if (!requirements?.amount) return null;
      const requiredAtomic = BigInt(requirements.amount);
      const balances = await this.gateway.getBalances();
      if (balances.gateway.available >= requiredAtomic) return null;
      return new InsufficientGatewayBalanceError(
        Number(formatUnits(requiredAtomic, USDC_DECIMALS)),
        Number(formatUnits(balances.gateway.available, USDC_DECIMALS))
      );
    } catch {
      return null;
    }
  }

  /** Snapshot of spend so an agent can budget its remaining calls. */
  getSpendSummary(): SpendSummary {
    const totalSpentUsdc = Number(formatUnits(this.totalSpentAtomic, USDC_DECIMALS));
    return {
      totalSpentUsdc,
      remainingCapUsdc:
        this.spendCapUsdc === Infinity ? Infinity : this.spendCapUsdc - totalSpentUsdc,
      spendCapUsdc: this.spendCapUsdc,
      paymentCount: this.paymentCount,
    };
  }

  // ── Setup / treasury passthroughs (handy for funding a demo agent) ──────────

  /** Check whether a URL advertises a Gateway-batched x402 option. */
  supports(url: string) {
    return this.gateway.supports(url);
  }

  /** Wallet + Gateway USDC balances in one call. */
  getBalances() {
    return this.gateway.getBalances();
  }

  /** Move USDC into the Gateway balance (one-time setup before paying). */
  deposit(amountUsdc: string) {
    return this.gateway.deposit(amountUsdc);
  }
}

/** Minimal shape of the onBeforePaymentCreation hook context we depend on. */
interface BeforePaymentCreationCtx {
  selectedRequirements: { amount: string };
}

export type { SupportedChainName };
