/**
 * ZkapProviderConfig — OAuth provider configuration for ZKAP wallet address derivation.
 *
 * Provides OAuth client IDs and Poseidon-hashed audience values (hAud) needed for
 * deterministic wallet address computation and ZK proof verification.
 *
 * Usage:
 *   // Company product preset (default: 'embedded-zkap')
 *   const config = ZkapProviderConfig.fromPreset('embedded-zkap');
 *
 *   // Third-party custom config
 *   const config = ZkapProviderConfig.custom({ providers: { ... }, hAudLists: '0x...' });
 *
 *   config.getClientId('GOOGLE');  // → OAuth client ID
 *   config.getHAud('GOOGLE');      // → Poseidon hash of client ID
 *   config.getHAudLists();         // → combined 3-of-3 hash
 */

import { PRESETS } from "./presets";
import type { ProviderPreset } from "./presets";
import { AaOperationError, AaOperationErrorCode } from "../errors";

export type SocialProvider = "GOOGLE" | "KAKAO" | "APPLE";

export interface ProviderEntry {
  /** OAuth Client ID (public value, appears in authorization URLs) */
  clientId: string;
  /** Poseidon hash of clientId — used by on-chain ZK verifier */
  hAud: string;
}

export interface ZkapProviderConfigOptions {
  providers: Record<SocialProvider, ProviderEntry>;
  /** Poseidon(hAud_google, hAud_kakao, hAud_apple) — 3-of-3 verifier */
  hAudLists: string;
  /** 1-of-1 verifier variant */
  hAudLists1: string;
}

export class ZkapProviderConfig {
  private readonly config: ZkapProviderConfigOptions;

  private constructor(config: ZkapProviderConfigOptions) {
    this.config = config;
  }

  /**
   * Create from a built-in product preset.
   * @param preset - 'embedded-zkap' (default) or 'zkap-web3'
   */
  static fromPreset(preset: ProviderPreset = "embedded-zkap"): ZkapProviderConfig {
    const data = PRESETS[preset];
    if (!data) {
      throw new AaOperationError({
        code: AaOperationErrorCode.CONFIG_UNSUPPORTED,
        operation: "from_preset",
        message: `Unknown preset: ${preset}. Available: ${Object.keys(PRESETS).join(", ")}`,
      });
    }
    return new ZkapProviderConfig(data);
  }

  /**
   * Create with custom provider configuration (for third-party apps).
   */
  static custom(options: ZkapProviderConfigOptions): ZkapProviderConfig {
    return new ZkapProviderConfig(options);
  }

  /** Get the OAuth client ID for a provider. Throws if not configured. */
  getClientId(provider: SocialProvider): string {
    const entry = this.getProviderEntry(provider);
    if (!entry.clientId) {
      throw new AaOperationError({
        code: AaOperationErrorCode.CONFIG_REQUIRED_FIELD_MISSING,
        operation: "get_client_id",
        message: `Provider ${provider} has no clientId configured in this preset`,
      });
    }
    return entry.clientId;
  }

  /** Get the Poseidon-hashed audience value for a provider. */
  getHAud(provider: SocialProvider): string {
    return this.getProviderEntry(provider).hAud;
  }

  /** Get the combined 3-of-3 hAudLists hash. */
  getHAudLists(): string {
    return this.config.hAudLists;
  }

  /** Get the 1-of-1 hAudLists hash. */
  getHAudLists1(): string {
    return this.config.hAudLists1;
  }

  /** Get the full provider entry (clientId + hAud). */
  getProviderEntry(provider: SocialProvider): ProviderEntry {
    const entry = this.config.providers[provider];
    if (!entry) {
      throw new AaOperationError({
        code: AaOperationErrorCode.CONFIG_UNSUPPORTED,
        operation: "get_provider_entry",
        message: `Unknown provider: ${provider}. Available: ${Object.keys(this.config.providers).join(", ")}`,
      });
    }
    return entry;
  }

  /** Serialize the config (deep copy). */
  toJSON(): ZkapProviderConfigOptions {
    return JSON.parse(JSON.stringify(this.config));
  }
}
