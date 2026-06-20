import { ethers } from "ethers";
import { IUserOpSigner } from "../utils/IUserOpSigner";
import { PrimitiveAccountKeyTypes } from "../types/AccountKey";
import { AaOperationError, AaOperationErrorCode } from "../errors";

/**
 * Signs UserOperation hashes using one or more Ethereum private keys (secp256k1 ECDSA).
 *
 * Use this signer when the smart account is controlled by a traditional EOA key.
 * Multiple keys can be provided to satisfy multi-key account configurations.
 *
 * @example
 * ```ts
 * const signer = new AddressKeySigner(["0xYOUR_PRIVATE_KEY"]);
 * const signatures = await signer.signUserOpHash(userOpHash);
 * ```
 */
export class AddressKeySigner implements IUserOpSigner {
  /**
   * Account key type identifiers handled by this signer.
   * Always `[PrimitiveAccountKeyTypes.keyAddress]`.
   */
  public readonly keyTypes: number[] = [PrimitiveAccountKeyTypes.keyAddress];
  private privateKeys: string[];

  /**
   * Creates an `AddressKeySigner` from one or more hex-encoded private keys.
   *
   * @param privateKeys - A non-empty array of valid hex-encoded secp256k1 private keys.
   * @throws If the array is empty or any key is not a valid private key.
   */
  constructor(privateKeys: string[]) {
    if (!Array.isArray(privateKeys) || privateKeys.length === 0) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_OUT_OF_RANGE,
        operation: "init_address_key_signer",
        message: "AddressKeySigner: privateKeys must be a non-empty array",
      });
    }
    for (let i = 0; i < privateKeys.length; i++) {
      try {
        new ethers.Wallet(privateKeys[i]);
      } catch {
        throw new AaOperationError({
          code: AaOperationErrorCode.SIGNER_KEY_INVALID,
          operation: "init_address_key_signer",
          message: `AddressKeySigner: privateKeys[${i}] is not a valid private key`,
        });
      }
    }
    this.privateKeys = privateKeys;
  }

  /**
   * Signs the given UserOperation hash with each configured private key.
   *
   * @param userOpHash - The 32-byte hex hash of the packed UserOperation.
   * @returns An array of serialized ECDSA signatures, one per private key.
   */
  async signUserOpHash(userOpHash: string): Promise<string[]> {
    const signatures: string[] = [];
    for (const privateKey of this.privateKeys) {
      const wallet = new ethers.Wallet(privateKey);
      const sig = wallet.signingKey.sign(ethers.getBytes(userOpHash)).serialized;
      signatures.push(sig);
    }
    return signatures;
  }

  /**
   * Removes private key references from memory.
   * @note JavaScript strings are immutable, so only the reference can be removed.
   *       Call this after use to prevent reuse of sensitive key data.
   */
  destroy(): void {
    this.privateKeys = [];
  }
}
