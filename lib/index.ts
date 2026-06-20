// Type definitions
export * from "./types/UserOperation";
export * from "./types/AccountKey";
export * from "./types/jwk";
export * from "./types/Swap";
export * from "./types/abi";

// Account classes
export { BaseAccount } from "./account/BaseAccount";
export { ZkapAccount } from "./account/ZkapAccount";

// Builder classes
export { BaseAccountBuilder } from "./builders/BaseAccountBuilder";
export { AccountKeyBuilder } from "./builders/AccountKeyBuilder";
export { ZkapBuilder } from "./builders/ZkapBuilder";
export { SwapBuilder } from "./builders/SwapBuilder";
export { CallDataBuilder } from "./builders/CallDataBuilder";
export { ZkapCreator } from "./builders/ZkapCreator";
export { ZkapFactoryBuilder } from "./builders/ZkapFactoryBuilder";
export { OneInchAggregator } from "./builders/aggregators/OneInchAggregator";

// Signer classes
export { AddressKeySigner } from "./signers/AddressKeySigner";
export { PasskeySigner } from "./signers/PasskeySigner";
export { ZkOAuthSigner } from "./signers/ZkOAuthSigner";
export { ZkOidcSigner } from "./signers/ZkOidcSigner";

// Paymaster service
export { PaymasterService, PaymasterMode } from "./utils/PaymasterService";
export type { PaymasterServiceConfig, PaymasterDataResponse } from "./utils/PaymasterService";

// Utility functions and interfaces
export * from "./utils/crypto";
export * from "./utils/signature";
export * from "./utils/base64url";
export { IUserOpSigner } from "./utils/IUserOpSigner";
export { packUserOperation, unpackUserOperation, toPimlicoFormat, createDummyPasskeySignature, createDummyZkSignature } from "./utils/userOpUtils";
export { computeSalt } from "./utils/salt";

// Bundler client
export { BundlerClient } from "./client/BundlerClient";
export { ZkapBundlerProvider, Erc4337BundlerProvider } from "./client/BundlerProvider";
export type { Erc4337BundlerProviderConfig } from "./client/BundlerProvider";
export type { BundlerProvider, UserOpStatus, UserOpReceipt } from "./client/types";

// Error model (ZkapAaError hierarchy + 카탈로그 + 팩토리)
export * from "./errors";
export { safeStringify } from "./utils/safeStringify";

// Pimlico format (for external bundler integration)
export type { PimlicoUserOperation, PimlicoGasEstimate } from "./types/UserOperation";

// Chain registry
export { ChainRegistry } from "./registry/ChainRegistry";
export type { ChainConfig } from "./registry/ChainRegistry";

// Account reader
export { AccountReader } from "./reader/AccountReader";
export type { TxKeyInfo, MasterKeyInfo, WebAuthnKeyData as AccountWebAuthnKeyData, KeyType } from "./reader/AccountReader";

// Wallet helper
export { WalletHelper } from "./helper/WalletHelper";
export type { WalletHelperConfig } from "./helper/WalletHelper";

// TxKey helper
export { TxKeyHelper } from "./helper/TxKeyHelper";
export type { WebAuthnNewKeyParams, ExistingKeyEntry } from "./helper/TxKeyHelper";

// Provider config
export { ZkapProviderConfig } from "./config/ZkapProviderConfig";
export type { SocialProvider, ProviderEntry, ZkapProviderConfigOptions } from "./config/ZkapProviderConfig";
export type { ProviderPreset } from "./config/presets";
