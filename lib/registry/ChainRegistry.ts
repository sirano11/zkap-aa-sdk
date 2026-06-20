import { AaFetchError, AaFetchErrorCode } from "../errors";

/**
 * On-chain and off-chain configuration for a supported EVM chain within the ZKAP ecosystem.
 *
 * Instances are fetched from the ZKAP API by {@link ChainRegistry} and should be
 * treated as read-only snapshots.
 */
export interface ChainConfig {
  /** EIP-155 chain ID (e.g. `1` for Ethereum mainnet, `137` for Polygon). */
  chainId: number;
  /** Human-readable chain name (e.g. `"Ethereum"`, `"Polygon"`). */
  name: string;
  /** JSON-RPC endpoint URL for this chain. */
  rpcUrl: string;
  /** Address of the ERC-4337 EntryPoint contract deployed on this chain. */
  entryPoint: string;
  /** Address of the ZKAP account factory contract on this chain. */
  zkapFactory: string;
  /** URL of the bundler RPC endpoint for this chain. */
  bundlerUrl: string;
  /** On-chain address of the Poseidon Merkle Tree directory contract. */
  poseidonMerkleTreeDirectory: string;
  /** Addresses of key ZKAP smart contracts on this chain. */
  contracts: {
    /** Address of the 1-of-1 ZkOAuth verifier contract. */
    zkOAuthVerifier1of1: string;
    /** Address of the 3-of-3 ZkOAuth verifier contract. */
    zkOAuthVerifier3of3: string;
    /**
     * Address of the hAudLists contract (audience allowlist v1).
     * Used by ZkOAuthSigner to verify that the OAuth `aud` claim is in the allowed set.
     */
    hAudLists: string;
    /**
     * Address of the hAudLists1 contract (audience allowlist v2, single-slot variant).
     * Introduced to support a simplified 1-of-1 audience verification path.
     * Use `hAudLists` for multi-slot verifiers; use `hAudLists1` for 1-of-1 verifiers.
     */
    hAudLists1: string;
  };
}

interface CacheEntry {
  config: ChainConfig;
  expiresAt: number;
}

const DEFAULT_API_URL = "https://api.zkap.app";
const DEFAULT_CACHE_TTL_MS = 300000; // 5 minutes

/**
 * Fetches and caches chain configuration from the ZKAP API.
 *
 * Results are cached in memory for `cacheTtlMs` milliseconds (default: 5 minutes)
 * to reduce API round-trips. Call {@link refresh} to invalidate the cache on demand.
 *
 * @example
 * ```ts
 * const registry = new ChainRegistry();
 * const config = await registry.getChainConfig(137); // Polygon
 * console.log(config.entryPoint);
 * ```
 */
export class ChainRegistry {
  private readonly apiUrl: string;
  private readonly cacheTtlMs: number;
  private cache: Map<number, CacheEntry> = new Map();
  private allChainsCache: { configs: ChainConfig[]; expiresAt: number } | null = null;

  /**
   * @param config.apiUrl - Base URL of the ZKAP API (default: `"https://api.zkap.app"`).
   * @param config.cacheTtlMs - Cache time-to-live in milliseconds (default: `300000` / 5 min).
   */
  constructor(config?: { apiUrl?: string; cacheTtlMs?: number }) {
    this.apiUrl = (config && config.apiUrl) ? config.apiUrl.replace(/\/$/, "") : DEFAULT_API_URL;
    this.cacheTtlMs = (config && config.cacheTtlMs != null) ? config.cacheTtlMs : DEFAULT_CACHE_TTL_MS;
  }

  /**
   * Fetch the {@link ChainConfig} for a specific chain, using the in-memory cache when available.
   *
   * @param chainId - EIP-155 chain ID to look up.
   * @returns The {@link ChainConfig} for the requested chain.
   * @throws `Error` if the chain is not found or the API request fails.
   *
   * @example
   * ```ts
   * const config = await registry.getChainConfig(1); // Ethereum mainnet
   * ```
   */
  async getChainConfig(chainId: number): Promise<ChainConfig> {
    const cached = this.cache.get(chainId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.config;
    }

    const url = `${this.apiUrl}/api/v1/chains/${chainId}`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      throw new AaFetchError({
        code: AaFetchErrorCode.TRANSPORT,
        operation: "get_chain_config",
        service: "chain_registry",
        url,
        method: "GET",
        cause: err,
        message: `ChainRegistry: network error fetching chainId ${chainId}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    if (!res.ok) {
      throw new AaFetchError({
        code: AaFetchErrorCode.HTTP_STATUS,
        httpStatus: res.status,
        operation: "get_chain_config",
        service: "chain_registry",
        url,
        method: "GET",
        message: `ChainRegistry: failed to fetch chainId ${chainId} (HTTP ${res.status})`,
      });
    }

    const data = await res.json() as Record<string, unknown>;
    const chainConfig = this._parseChainConfig(data);

    this.cache.set(chainId, {
      config: chainConfig,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return chainConfig;
  }

  /**
   * Fetch all chains supported by the ZKAP platform, using the in-memory cache when available.
   *
   * Also populates the per-chain cache so subsequent {@link getChainConfig} calls are served
   * from memory without additional network requests.
   *
   * @returns An array of {@link ChainConfig} objects for every supported chain.
   * @throws `Error` if the API request fails.
   *
   * @example
   * ```ts
   * const chains = await registry.getSupportedChains();
   * chains.forEach(c => console.log(c.chainId, c.name));
   * ```
   */
  async getSupportedChains(): Promise<ChainConfig[]> {
    if (this.allChainsCache && Date.now() < this.allChainsCache.expiresAt) {
      return this.allChainsCache.configs;
    }

    const url = `${this.apiUrl}/api/v1/chains`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      throw new AaFetchError({
        code: AaFetchErrorCode.TRANSPORT,
        operation: "get_supported_chains",
        service: "chain_registry",
        url,
        method: "GET",
        cause: err,
        message: `ChainRegistry: network error fetching supported chains: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    if (!res.ok) {
      throw new AaFetchError({
        code: AaFetchErrorCode.HTTP_STATUS,
        httpStatus: res.status,
        operation: "get_supported_chains",
        service: "chain_registry",
        url,
        method: "GET",
        message: `ChainRegistry: failed to fetch supported chains (HTTP ${res.status})`,
      });
    }

    const data = await res.json() as Record<string, unknown> | unknown[];
    const list: unknown[] = Array.isArray(data) ? data : ((data as Record<string, unknown>).chains || (data as Record<string, unknown>).data || []) as unknown[];
    const configs = list.map((item) => this._parseChainConfig(item as Record<string, unknown>));

    this.allChainsCache = {
      configs,
      expiresAt: Date.now() + this.cacheTtlMs,
    };

    // Populate per-chain cache as well
    for (const cfg of configs) {
      this.cache.set(cfg.chainId, {
        config: cfg,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
    }

    return configs;
  }

  /**
   * Invalidate all cached chain configurations.
   *
   * The next call to {@link getChainConfig} or {@link getSupportedChains} will
   * fetch fresh data from the API.
   */
  refresh(): void {
    this.cache.clear();
    this.allChainsCache = null;
  }

  private _parseChainConfig(data: Record<string, unknown>): ChainConfig {
    // Support both flat and nested contract shapes from the API
    const contracts = (data.contracts as Record<string, string>) || {};

    const chainId = Number(data.chainId);
    const rpcUrl = String(data.rpcUrl || "");
    const entryPoint = String(data.entryPoint || data.entrypoint || "");
    const zkapFactory = String(data.zkapFactory || data.factory || "");

    if (!chainId || isNaN(chainId)) {
      throw new AaFetchError({
        code: AaFetchErrorCode.RESPONSE_SHAPE,
        operation: "parse_chain_config",
        service: "chain_registry",
        url: this.apiUrl,
        method: "GET",
        message: `ChainRegistry: invalid or missing chainId in API response: ${JSON.stringify(data.chainId)}`,
      });
    }
    if (!rpcUrl) {
      throw new AaFetchError({
        code: AaFetchErrorCode.RESPONSE_SHAPE,
        operation: "parse_chain_config",
        service: "chain_registry",
        url: this.apiUrl,
        method: "GET",
        message: `ChainRegistry: missing rpcUrl for chainId ${chainId}`,
      });
    }
    if (!entryPoint) {
      throw new AaFetchError({
        code: AaFetchErrorCode.RESPONSE_SHAPE,
        operation: "parse_chain_config",
        service: "chain_registry",
        url: this.apiUrl,
        method: "GET",
        message: `ChainRegistry: missing entryPoint for chainId ${chainId}`,
      });
    }
    if (!zkapFactory) {
      throw new AaFetchError({
        code: AaFetchErrorCode.RESPONSE_SHAPE,
        operation: "parse_chain_config",
        service: "chain_registry",
        url: this.apiUrl,
        method: "GET",
        message: `ChainRegistry: missing zkapFactory for chainId ${chainId}`,
      });
    }

    return {
      chainId,
      name: String(data.name || ""),
      rpcUrl,
      entryPoint,
      zkapFactory,
      bundlerUrl: String(data.bundlerUrl || ""),
      poseidonMerkleTreeDirectory: String(
        data.poseidonMerkleTreeDirectory || contracts.poseidonMerkleTreeDirectory || ""
      ),
      contracts: {
        zkOAuthVerifier1of1: String(contracts.zkOAuthVerifier1of1 || data.zkOAuthVerifier1of1 || ""),
        zkOAuthVerifier3of3: String(contracts.zkOAuthVerifier3of3 || data.zkOAuthVerifier3of3 || ""),
        hAudLists: String(contracts.hAudLists || data.hAudLists || ""),
        hAudLists1: String(contracts.hAudLists1 || data.hAudLists1 || ""),
      },
    };
  }
}
