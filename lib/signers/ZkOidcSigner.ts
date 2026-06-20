import { ethers } from "ethers";
import { IUserOpSigner } from "../utils/IUserOpSigner";
import { PrimitiveAccountKeyTypes } from "../types/AccountKey";
import { BN254_FR } from "../utils/crypto";
import { AaOperationError, AaOperationErrorCode } from "../errors";

function validateBN254Field(value: string, label: string): void {
  const val = BigInt(value);
  if (val < 0n || val >= BN254_FR) {
    throw new AaOperationError({
      code: AaOperationErrorCode.CRYPTO_FIELD_RANGE,
      operation: "validate_b_n254_field",
      message: `${label} is out of BN254 scalar field range: ${value}`,
    });
  }
}

export class ZkOidcSigner implements IUserOpSigner {
  public readonly keyTypes: number[] = [PrimitiveAccountKeyTypes.keyZkOAuthRS256];
  private sharedInputs: string[] | undefined;
  private jwtExpList: string[] | undefined;
  private partialRhsList: string[] | undefined;
  private proofs: string[][] | undefined;

  /**
   * Sets ZK proof data.
   * @param data.sharedInputs - Array of 6 elements
   *   - [0] hanchor: Anchor hash
   *   - [1] h_ctx: Context hash
   *   - [2] root: Merkle root
   *   - [3] h_sign_userop: UserOp hash (mod SNARK_SCALAR_FIELD)
   *   - [4] lhs: Left-hand side sum
   *   - [5] h_aud_list: Audience list hash
   * @param data.jwtExpList - K elements: jwt_exp (Unix timestamp) for each proof
   * @param data.partialRhsList - K elements: partial_rhs for each proof
   * @param data.proofs - K x 8 array: K Groth16 proofs
   */
  setProofData(data: {
    sharedInputs: string[];
    jwtExpList: string[];
    partialRhsList: string[];
    proofs: string[][];
  }): void {
    if (!Array.isArray(data.sharedInputs) || data.sharedInputs.length !== 6) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_PROOF_INVALID,
        operation: "set_proof_data",
        message: `setProofData: sharedInputs must be an array of 6 elements, got ${data.sharedInputs?.length}`,
      });
    }
    for (let i = 0; i < data.sharedInputs.length; i++) {
      if (typeof data.sharedInputs[i] !== 'string' || !/^\d+$/.test(data.sharedInputs[i])) {
        throw new AaOperationError({
          code: AaOperationErrorCode.SIGNER_PROOF_INVALID,
          operation: "set_proof_data",
          message: `setProofData: sharedInputs[${i}] must be a numeric string, got ${JSON.stringify(data.sharedInputs[i])}`,
        });
      }
      validateBN254Field(data.sharedInputs[i], `sharedInputs[${i}]`);
    }
    if (!Array.isArray(data.jwtExpList)) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_PROOF_INVALID,
        operation: "set_proof_data",
        message: "setProofData: jwtExpList must be an array",
      });
    }
    if (!Array.isArray(data.partialRhsList)) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_PROOF_INVALID,
        operation: "set_proof_data",
        message: "setProofData: partialRhsList must be an array",
      });
    }
    if (!Array.isArray(data.proofs) || data.proofs.length === 0) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_PROOF_INVALID,
        operation: "set_proof_data",
        message: "setProofData: proofs must be a non-empty array",
      });
    }
    if (data.jwtExpList.length !== data.proofs.length) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_PROOF_INVALID,
        operation: "set_proof_data",
        message: `setProofData: jwtExpList.length (${data.jwtExpList.length}) must equal proofs.length (${data.proofs.length})`,
      });
    }
    if (data.partialRhsList.length !== data.proofs.length) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_PROOF_INVALID,
        operation: "set_proof_data",
        message: `setProofData: partialRhsList.length (${data.partialRhsList.length}) must equal proofs.length (${data.proofs.length})`,
      });
    }
    for (let i = 0; i < data.proofs.length; i++) {
      if (!Array.isArray(data.proofs[i]) || data.proofs[i].length !== 8) {
        throw new AaOperationError({
          code: AaOperationErrorCode.SIGNER_PROOF_INVALID,
          operation: "set_proof_data",
          message: `setProofData: proofs[${i}] must be an array of 8 elements, got ${data.proofs[i]?.length}`,
        });
      }
    }
    // Validate BN254 scalar field range
    for (let i = 0; i < data.jwtExpList.length; i++) {
      validateBN254Field(data.jwtExpList[i], `jwtExpList[${i}]`);
    }
    for (let i = 0; i < data.partialRhsList.length; i++) {
      validateBN254Field(data.partialRhsList[i], `partialRhsList[${i}]`);
    }
    for (let i = 0; i < data.proofs.length; i++) {
      for (let j = 0; j < data.proofs[i].length; j++) {
        validateBN254Field(data.proofs[i][j], `proofs[${i}][${j}]`);
      }
    }
    this.sharedInputs = data.sharedInputs;
    this.jwtExpList = data.jwtExpList;
    this.partialRhsList = data.partialRhsList;
    this.proofs = data.proofs;
  }

  async signUserOpHash(userOpHash: string): Promise<string[]> {
    if (!this.sharedInputs || !this.jwtExpList || !this.partialRhsList || !this.proofs) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_NOT_INITIALIZED,
        operation: "sign_user_op_hash",
        message: "sharedInputs, jwtExpList, partialRhsList, and proofs must be set before signing",
      });
    }

    if (typeof userOpHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(userOpHash)) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_FORMAT,
        operation: "sign_user_op_hash",
        message: `signUserOpHash: userOpHash must be a 0x-prefixed 32-byte hex string (66 chars), got: ${userOpHash}`,
      });
    }

    // Validate binding between userOpHash and sharedInputs[3]
    // sharedInputs[3] == userOpHash mod BN254_FR
    const expectedHSignUserOp = (BigInt(userOpHash) % BN254_FR).toString();
    if (this.sharedInputs[3] !== expectedHSignUserOp) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_PROOF_INVALID,
        operation: "sign_user_op_hash",
        message: `signUserOpHash: proof does not match userOpHash. sharedInputs[3] must equal userOpHash mod SNARK_SCALAR_FIELD`,
      });
    }

    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const encoded = abiCoder.encode(
      ["uint256[6]", "uint256[]", "uint256[]", "uint256[8][]"],
      [this.sharedInputs, this.jwtExpList, this.partialRhsList, this.proofs]
    );

    return [encoded];
  }

  /**
   * Removes ZK proof data references from memory.
   * @note Call this after use to prevent reuse of sensitive proof data.
   */
  destroy(): void {
    this.sharedInputs = undefined;
    this.jwtExpList = undefined;
    this.partialRhsList = undefined;
    this.proofs = undefined;
  }
}
