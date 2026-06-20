import { ethers } from "ethers";

import { AaOperationError, AaOperationErrorCode } from "../errors";

export class CallDataBuilder {
  private contractInterface: ethers.Interface;

  constructor(abi: string | ethers.Fragment[]) {
    this.contractInterface = new ethers.Interface(abi);
  }

  /**
   * Generates callData for a specific contract method.
   * @param methodName - The contract method name.
   * @param params - Parameters to pass to the method.
   * @returns The encoded callData.
   */
  public encode(methodName: string, params: any[]): string {
    if (!this.contractInterface.getFunction(methodName)) {
      throw new AaOperationError({
        code: AaOperationErrorCode.ENCODE_METHOD_NOT_IN_ABI,
        operation: "encode",
        message: `Method ${methodName} not found in ABI.`,
      });
    }
    return this.contractInterface.encodeFunctionData(methodName, params);
  }

  /**
   * Decodes callData for a specific contract method.
   * @param methodName - The contract method name.
   * @param callData - The callData to decode.
   * @returns The decoded parameters.
   * @experimental This method is unverified. Use only after thorough testing.
   * @internal Not recommended for production use until validated.
   */
  public decode(methodName: string, callData: string): any[] {
    if (!this.contractInterface.getFunction(methodName)) {
      throw new AaOperationError({
        code: AaOperationErrorCode.ENCODE_METHOD_NOT_IN_ABI,
        operation: "decode",
        message: `Method ${methodName} not found in ABI.`,
      });
    }
    return this.contractInterface.decodeFunctionData(methodName, callData);
  }
}
