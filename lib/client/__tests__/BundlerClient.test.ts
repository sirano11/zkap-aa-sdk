/**
 * Tests for BundlerClient, BundlerProvider, and the error model the providers throw
 * (UserOpRevertError / AaFetchError via the bundlerErrorWrapper helpers).
 */

import { ethers } from 'ethers';

import { BundlerClient } from '../BundlerClient';
import { ZkapBundlerProvider, Erc4337BundlerProvider } from '../BundlerProvider';
import { BundlerError } from '../types';
import { AaCode, AaFetchError, AaFetchErrorCode, UserOpRevertError } from '../../errors';
import { EntryPointABI } from '../../types/abi';
import revertReceipts from './fixtures/revert-receipts.json';

// Real Base Sepolia reverted-UserOp receipts (4). The decode primitive is unit-tested
// on the captured bytes in revertDecoder.test.ts; here we run the full on-chain path
// (receipt logs → decodeRevertReason) through the provider.
type RealRevertFixture = {
  txHash: string;
  note: string;
  revertReason: string;
  expect: { name: string; args: unknown[] } | null;
  logs: { topics: string[]; data: string }[];
};
const realRevertFixtures = revertReceipts as RealRevertFixture[];
import type { BundlerProvider, UserOpReceipt, UserOpStatus } from '../types';
import type { PackedUserOperation } from '../../types/UserOperation';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePackedUserOp(overrides?: Partial<PackedUserOperation>): PackedUserOperation {
  return {
    sender: '0x' + '11'.repeat(20),
    nonce: '0x0',
    initCode: '0x',
    callData: '0x',
    accountGasLimits: '0x' + '00'.repeat(16) + '00'.repeat(16),
    preVerificationGas: '0x5208',
    gasFees: '0x' + '00'.repeat(16) + '00'.repeat(16),
    paymasterAndData: '0x',
    signature: '0x',
    ...overrides,
  };
}

const MOCK_USER_OP_HASH = '0x' + 'ab'.repeat(32);
const MOCK_ENTRY_POINT = '0x' + '5F'.padStart(40, '5');

function makeReceipt(success = true): UserOpReceipt {
  return {
    userOpHash: MOCK_USER_OP_HASH,
    txHash: '0x' + 'cc'.repeat(32),
    blockNumber: 1000,
    success,
    actualGasCost: '21000',
    actualGasUsed: '21000',
  };
}

// ---------------------------------------------------------------------------
// Mock BundlerProvider for BundlerClient unit tests
// ---------------------------------------------------------------------------

function makeMockProvider(overrides?: Partial<BundlerProvider>): BundlerProvider {
  return {
    submitUserOp: jest.fn().mockResolvedValue(MOCK_USER_OP_HASH),
    getStatus: jest.fn().mockResolvedValue('included' as UserOpStatus),
    getReceipt: jest.fn().mockResolvedValue(makeReceipt()),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// BundlerClient
// ---------------------------------------------------------------------------

describe('BundlerClient', () => {
  describe('submitUserOp', () => {
    it('delegates to provider and returns userOpHash', async () => {
      const provider = makeMockProvider();
      const client = new BundlerClient(provider);
      const userOp = makePackedUserOp();

      const hash = await client.submitUserOp(userOp, MOCK_ENTRY_POINT);

      expect(hash).toBe(MOCK_USER_OP_HASH);
      expect(provider.submitUserOp).toHaveBeenCalledWith(userOp, MOCK_ENTRY_POINT);
    });

    it('propagates provider errors', async () => {
      const provider = makeMockProvider({
        submitUserOp: jest.fn().mockRejectedValue(new BundlerError('rejected', 'BUNDLER_REJECTED', false)),
      });
      const client = new BundlerClient(provider);

      await expect(client.submitUserOp(makePackedUserOp(), MOCK_ENTRY_POINT))
        .rejects.toThrow('rejected');
    });
  });

  describe('getStatus', () => {
    it('delegates to provider', async () => {
      const provider = makeMockProvider({
        getStatus: jest.fn().mockResolvedValue('pending' as UserOpStatus),
      });
      const client = new BundlerClient(provider);

      const status = await client.getStatus(MOCK_USER_OP_HASH);

      expect(status).toBe('pending');
      expect(provider.getStatus).toHaveBeenCalledWith(MOCK_USER_OP_HASH);
    });
  });

  describe('waitForReceipt', () => {
    it('returns receipt immediately when status is included', async () => {
      const receipt = makeReceipt(true);
      const provider = makeMockProvider({
        getStatus: jest.fn().mockResolvedValue('included' as UserOpStatus),
        getReceipt: jest.fn().mockResolvedValue(receipt),
      });
      const client = new BundlerClient(provider);

      const result = await client.waitForReceipt(MOCK_USER_OP_HASH, { pollInterval: 10, timeout: 5000 });

      expect(result).toEqual(receipt);
      expect(provider.getStatus).toHaveBeenCalledTimes(1);
    });

    it('returns receipt when status is failed', async () => {
      const receipt = makeReceipt(false);
      const provider = makeMockProvider({
        getStatus: jest.fn().mockResolvedValue('failed' as UserOpStatus),
        getReceipt: jest.fn().mockResolvedValue(receipt),
      });
      const client = new BundlerClient(provider);

      const result = await client.waitForReceipt(MOCK_USER_OP_HASH, { pollInterval: 10, timeout: 5000 });

      expect(result.success).toBe(false);
    });

    it('polls until included status is found', async () => {
      const getStatus = jest.fn()
        .mockResolvedValueOnce('pending' as UserOpStatus)
        .mockResolvedValueOnce('pending' as UserOpStatus)
        .mockResolvedValueOnce('included' as UserOpStatus);
      const provider = makeMockProvider({ getStatus, getReceipt: jest.fn().mockResolvedValue(makeReceipt()) });
      const client = new BundlerClient(provider);

      const result = await client.waitForReceipt(MOCK_USER_OP_HASH, { pollInterval: 10, timeout: 5000 });

      expect(getStatus).toHaveBeenCalledTimes(3);
      expect(result.success).toBe(true);
    });

    it('builds a fallback receipt when getReceipt returns null for included status', async () => {
      const provider = makeMockProvider({
        getStatus: jest.fn().mockResolvedValue('included' as UserOpStatus),
        getReceipt: jest.fn().mockResolvedValue(null),
      });
      const client = new BundlerClient(provider);

      const result = await client.waitForReceipt(MOCK_USER_OP_HASH, { pollInterval: 10, timeout: 5000 });

      expect(result.userOpHash).toBe(MOCK_USER_OP_HASH);
      expect(result.success).toBe(true);
      expect(result.txHash).toBe('');
      expect(result.blockNumber).toBe(0);
    });

    it('builds a fallback receipt when getReceipt returns null for failed status', async () => {
      const provider = makeMockProvider({
        getStatus: jest.fn().mockResolvedValue('failed' as UserOpStatus),
        getReceipt: jest.fn().mockResolvedValue(null),
      });
      const client = new BundlerClient(provider);

      const result = await client.waitForReceipt(MOCK_USER_OP_HASH, { pollInterval: 10, timeout: 5000 });

      expect(result.success).toBe(false);
    });

    it('throws BundlerError with BUNDLER_TIMEOUT code on timeout', async () => {
      const provider = makeMockProvider({
        getStatus: jest.fn().mockResolvedValue('pending' as UserOpStatus),
      });
      const client = new BundlerClient(provider);

      await expect(
        client.waitForReceipt(MOCK_USER_OP_HASH, { pollInterval: 10, timeout: 50 })
      ).rejects.toThrow(BundlerError);

      await expect(
        client.waitForReceipt(MOCK_USER_OP_HASH, { pollInterval: 10, timeout: 50 })
      ).rejects.toMatchObject({ code: 'BUNDLER_TIMEOUT', retryable: false });
    });

    it('timeout error message contains userOpHash and timeout value', async () => {
      const provider = makeMockProvider({
        getStatus: jest.fn().mockResolvedValue('not_found' as UserOpStatus),
      });
      const client = new BundlerClient(provider);

      await expect(
        client.waitForReceipt(MOCK_USER_OP_HASH, { pollInterval: 10, timeout: 50 })
      ).rejects.toThrow(MOCK_USER_OP_HASH.slice(0, 10));
    });

    it('uses default poll interval and timeout when options not provided', async () => {
      // This test just verifies the client doesn't throw immediately with defaults.
      // We use a very fast-resolving mock so it exits the loop before real timeout.
      const provider = makeMockProvider({
        getStatus: jest.fn().mockResolvedValue('included' as UserOpStatus),
        getReceipt: jest.fn().mockResolvedValue(makeReceipt()),
      });
      const client = new BundlerClient(provider);

      const result = await client.waitForReceipt(MOCK_USER_OP_HASH);
      expect(result.userOpHash).toBe(MOCK_USER_OP_HASH);
    });
  });
});

// ---------------------------------------------------------------------------
// BundlerError
// ---------------------------------------------------------------------------

describe('BundlerError', () => {
  it('has correct name, code, and retryable flag', () => {
    const err = new BundlerError('msg', 'AA21_INSUFFICIENT_FUNDS', false);
    expect(err.name).toBe('BundlerError');
    expect(err.code).toBe('AA21_INSUFFICIENT_FUNDS');
    expect(err.retryable).toBe(false);
    expect(err.message).toBe('msg');
    expect(err).toBeInstanceOf(Error);
  });

  it('retryable defaults to false', () => {
    const err = new BundlerError('msg', 'BUNDLER_REJECTED');
    expect(err.retryable).toBe(false);
  });

  it('retryable can be set to true', () => {
    const err = new BundlerError('network issue', 'NETWORK_ERROR', true);
    expect(err.retryable).toBe(true);
  });

  it('is instanceof BundlerError and Error', () => {
    const err = new BundlerError('msg', 'BUNDLER_TIMEOUT', false);
    expect(err instanceof BundlerError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ZkapBundlerProvider
// ---------------------------------------------------------------------------

describe('ZkapBundlerProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('submitUserOp', () => {
    it('sends POST to /api/v1/bundler/submit-direct with userOp', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ userOpHash: MOCK_USER_OP_HASH }),
      });

      const provider = new ZkapBundlerProvider();
      const userOp = makePackedUserOp();
      const hash = await provider.submitUserOp(userOp, MOCK_ENTRY_POINT);

      expect(hash).toBe(MOCK_USER_OP_HASH);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.zkap.app/api/v1/bundler/submit-direct',
        expect.objectContaining({ method: 'POST' })
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.userOp).toEqual(userOp);
    });

    it('uses custom baseUrl from config', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ userOpHash: MOCK_USER_OP_HASH }),
      });

      const provider = new ZkapBundlerProvider({ baseUrl: 'https://custom.api.example.com' });
      await provider.submitUserOp(makePackedUserOp(), MOCK_ENTRY_POINT);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.api.example.com/api/v1/bundler/submit-direct',
        expect.any(Object)
      );
    });

    it('strips trailing slash from baseUrl', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ userOpHash: MOCK_USER_OP_HASH }),
      });

      const provider = new ZkapBundlerProvider({ baseUrl: 'https://custom.api.example.com/' });
      await provider.submitUserOp(makePackedUserOp(), MOCK_ENTRY_POINT);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.api.example.com/api/v1/bundler/submit-direct',
        expect.any(Object)
      );
    });

    it('throws AaFetchError (TRANSPORT) on fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const provider = new ZkapBundlerProvider();
      await expect(provider.submitUserOp(makePackedUserOp(), MOCK_ENTRY_POINT))
        .rejects.toMatchObject({ code: AaFetchErrorCode.TRANSPORT, service: 'bundler' });
    });

    it('classifies an AA prefix in the error body as UserOpRevertError', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('AA21: insufficient funds'),
      });

      const provider = new ZkapBundlerProvider();
      const err = await provider.submitUserOp(makePackedUserOp(), MOCK_ENTRY_POINT).catch((e) => e);
      expect(err).toBeInstanceOf(UserOpRevertError);
      expect(err.code).toBe(AaCode.AA21_INSUFFICIENT_PREFUND);
      expect(err.rawBundlerError).toContain('AA21'); // raw preserved
    });

    it('throws AaFetchError (RESPONSE_SHAPE) when response is missing userOpHash', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const provider = new ZkapBundlerProvider();
      await expect(provider.submitUserOp(makePackedUserOp(), MOCK_ENTRY_POINT))
        .rejects.toMatchObject({ code: AaFetchErrorCode.RESPONSE_SHAPE });
    });
  });

  describe('getStatus', () => {
    it('returns not_found on 404', async () => {
      mockFetch.mockResolvedValueOnce({ status: 404, ok: false });

      const provider = new ZkapBundlerProvider();
      const status = await provider.getStatus(MOCK_USER_OP_HASH);

      expect(status).toBe('not_found');
    });

    it('returns included for success status values', async () => {
      for (const s of ['included', 'confirmed', 'success']) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ status: s }),
        });
        const provider = new ZkapBundlerProvider();
        expect(await provider.getStatus(MOCK_USER_OP_HASH)).toBe('included');
      }
    });

    it('returns failed for failed/reverted status', async () => {
      for (const s of ['failed', 'reverted']) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ status: s }),
        });
        const provider = new ZkapBundlerProvider();
        expect(await provider.getStatus(MOCK_USER_OP_HASH)).toBe('failed');
      }
    });

    it('returns pending for pending/submitted status', async () => {
      for (const s of ['pending', 'submitted']) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ status: s }),
        });
        const provider = new ZkapBundlerProvider();
        expect(await provider.getStatus(MOCK_USER_OP_HASH)).toBe('pending');
      }
    });

    it('returns not_found for unknown status string', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 'unknown_status' }),
      });
      const provider = new ZkapBundlerProvider();
      expect(await provider.getStatus(MOCK_USER_OP_HASH)).toBe('not_found');
    });

    it('throws AaFetchError (TRANSPORT) on fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      const provider = new ZkapBundlerProvider();
      await expect(provider.getStatus(MOCK_USER_OP_HASH))
        .rejects.toMatchObject({ code: AaFetchErrorCode.TRANSPORT, service: 'bundler' });
    });

    it('throws AaFetchError (HTTP_STATUS) on non-ok non-404 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });
      const provider = new ZkapBundlerProvider();
      await expect(provider.getStatus(MOCK_USER_OP_HASH))
        .rejects.toMatchObject({ code: AaFetchErrorCode.HTTP_STATUS, httpStatus: 500 });
    });
  });

  describe('getReceipt', () => {
    it('returns null when fetch fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network'));
      const provider = new ZkapBundlerProvider();
      expect(await provider.getReceipt(MOCK_USER_OP_HASH)).toBeNull();
    });

    it('returns null when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      const provider = new ZkapBundlerProvider();
      expect(await provider.getReceipt(MOCK_USER_OP_HASH)).toBeNull();
    });

    it('returns null for pending status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'pending' }),
      });
      const provider = new ZkapBundlerProvider();
      expect(await provider.getReceipt(MOCK_USER_OP_HASH)).toBeNull();
    });

    it('returns receipt for included status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          status: 'included',
          bundleHash: '0x' + 'cc'.repeat(32),
          blockNumber: 999,
          actualGasCost: '50000',
          actualGasUsed: '21000',
        }),
      });
      const provider = new ZkapBundlerProvider();
      const receipt = await provider.getReceipt(MOCK_USER_OP_HASH);

      expect(receipt).not.toBeNull();
      expect(receipt!.userOpHash).toBe(MOCK_USER_OP_HASH);
      expect(receipt!.success).toBe(true);
      expect(receipt!.blockNumber).toBe(999);
    });

    it('returns receipt with success=false for failed status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'failed' }),
      });
      const provider = new ZkapBundlerProvider();
      const receipt = await provider.getReceipt(MOCK_USER_OP_HASH);
      expect(receipt!.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Erc4337BundlerProvider
// ---------------------------------------------------------------------------

describe('Erc4337BundlerProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('submitUserOp', () => {
    it('sends eth_sendUserOperation JSON-RPC with userOp and entryPoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: MOCK_USER_OP_HASH }),
      });

      const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
      const userOp = makePackedUserOp();
      const hash = await provider.submitUserOp(userOp, MOCK_ENTRY_POINT);

      expect(hash).toBe(MOCK_USER_OP_HASH);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.method).toBe('eth_sendUserOperation');
      expect(callBody.params[0]).toEqual(userOp);
      expect(callBody.params[1]).toBe(MOCK_ENTRY_POINT);
      expect(callBody.jsonrpc).toBe('2.0');
    });

    it('classifies an AA prefix in the JSON-RPC error as UserOpRevertError', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          jsonrpc: '2.0',
          id: 1,
          error: { message: 'AA21 insufficient funds for gas' },
        }),
      });

      const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
      const err = await provider.submitUserOp(makePackedUserOp(), MOCK_ENTRY_POINT).catch((e) => e);
      expect(err).toBeInstanceOf(UserOpRevertError);
      expect(err.code).toBe(AaCode.AA21_INSUFFICIENT_PREFUND);
      expect(err.operation).toBe('submit_user_op');
    });

    it('throws AaFetchError (TRANSPORT) on fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('connection refused'));

      const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
      await expect(provider.submitUserOp(makePackedUserOp(), MOCK_ENTRY_POINT))
        .rejects.toMatchObject({ code: AaFetchErrorCode.TRANSPORT, service: 'bundler' });
    });
  });

  describe('getStatus', () => {
    it('returns not_found when receipt is null', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: null }),
      });

      const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
      expect(await provider.getStatus(MOCK_USER_OP_HASH)).toBe('not_found');
    });

    it('returns included when receipt.success is true', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: { success: true } }),
      });

      const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
      expect(await provider.getStatus(MOCK_USER_OP_HASH)).toBe('included');
    });

    it('returns failed when receipt.success is false', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: { success: false } }),
      });

      const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
      expect(await provider.getStatus(MOCK_USER_OP_HASH)).toBe('failed');
    });
  });

  describe('getReceipt', () => {
    it('returns null when rpcCall returns null', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: null }),
      });

      const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
      expect(await provider.getReceipt(MOCK_USER_OP_HASH)).toBeNull();
    });

    it('reads transactionHash and blockNumber from nested receipt (ERC-4337 spec shape)', async () => {
      const txHash = '0x' + 'aa'.repeat(32);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          result: {
            userOpHash: MOCK_USER_OP_HASH,
            entryPoint: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
            sender: '0xe7E34106E83A92b4a45418Bff86381eB1C4e0258',
            nonce: '0x4',
            success: true,
            actualGasCost: '100000',
            actualGasUsed: '80000',
            logs: [],
            receipt: {
              transactionHash: txHash,
              blockNumber: 12345,
              blockHash: '0x' + 'bb'.repeat(32),
              status: '0x1',
            },
          },
        }),
      });

      const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
      const receipt = await provider.getReceipt(MOCK_USER_OP_HASH);

      expect(receipt).not.toBeNull();
      expect(receipt!.txHash).toBe(txHash);
      expect(receipt!.blockNumber).toBe(12345);
      expect(receipt!.success).toBe(true);
      expect(receipt!.actualGasCost).toBe('100000');
      expect(receipt!.actualGasUsed).toBe('80000');
      expect(receipt!.userOpHash).toBe(MOCK_USER_OP_HASH);
    });

    it('parses hex blockNumber from nested receipt (real Pimlico shape)', async () => {
      const txHash = '0xf8b9a5cf1a4e4069d72e05b2b67ef92164c56bc812ef9f1d076fee4ff99ae51a';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          result: {
            userOpHash: MOCK_USER_OP_HASH,
            success: true,
            actualGasUsed: '0x4e773',
            actualGasCost: '0x1cbbe82aeed3c0',
            logs: [],
            receipt: {
              transactionHash: txHash,
              blockNumber: '0xcf5e155',
              status: '0x1',
            },
          },
        }),
      });

      const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
      const receipt = await provider.getReceipt(MOCK_USER_OP_HASH);

      expect(receipt!.txHash).toBe(txHash);
      expect(receipt!.blockNumber).toBe(217440597);
      expect(receipt!.success).toBe(true);
    });

    it('falls back to top-level transactionHash for non-conforming bundlers', async () => {
      const txHash = '0x' + 'dd'.repeat(32);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          result: {
            transactionHash: txHash,
            blockNumber: 12345,
            success: true,
            actualGasCost: '100000',
            actualGasUsed: '80000',
          },
        }),
      });

      const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
      const receipt = await provider.getReceipt(MOCK_USER_OP_HASH);

      expect(receipt!.txHash).toBe(txHash);
      expect(receipt!.blockNumber).toBe(12345);
      expect(receipt!.success).toBe(true);
    });

    it('falls back to top-level txHash when transactionHash is absent', async () => {
      const txHash = '0x' + 'ee'.repeat(32);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          result: {
            txHash,
            blockNumber: 999,
            success: false,
            actualGasCost: '0',
            actualGasUsed: '0',
          },
        }),
      });

      const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
      const receipt = await provider.getReceipt(MOCK_USER_OP_HASH);

      expect(receipt!.txHash).toBe(txHash);
      expect(receipt!.success).toBe(false);
    });

    it('prefers nested receipt.transactionHash over top-level when both exist', async () => {
      const nestedHash = '0x' + 'aa'.repeat(32);
      const topLevelHash = '0x' + 'bb'.repeat(32);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          result: {
            transactionHash: topLevelHash,
            success: true,
            receipt: { transactionHash: nestedHash, blockNumber: 7 },
          },
        }),
      });

      const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
      const receipt = await provider.getReceipt(MOCK_USER_OP_HASH);

      expect(receipt!.txHash).toBe(nestedHash);
      expect(receipt!.blockNumber).toBe(7);
    });

    it('returns empty string txHash when neither nested nor top-level present', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          result: { blockNumber: 100, success: true },
        }),
      });

      const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
      const receipt = await provider.getReceipt(MOCK_USER_OP_HASH);

      expect(receipt!.txHash).toBe('');
      expect(receipt!.blockNumber).toBe(100);
    });
  });
});

// ---------------------------------------------------------------------------
// Provider → bundlerErrorWrapper integration. The exhaustive prefix/revert matrix
// lives in bundlerErrorWrapper.test.ts; here we only assert the provider routes a
// JSON-RPC error through classifyBundlerError and surfaces the right class.
// ---------------------------------------------------------------------------

describe('JSON-RPC error classification (via Erc4337BundlerProvider)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  function makeRpcError(error: unknown) {
    return mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ error }),
    });
  }

  it('routes an AA validation prefix to UserOpRevertError with phase', async () => {
    makeRpcError({ message: 'AA31 paymaster deposit too low' });
    const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
    const err = await provider.submitUserOp(makePackedUserOp(), MOCK_ENTRY_POINT).catch((e) => e);
    expect(err).toBeInstanceOf(UserOpRevertError);
    expect(err.code).toBe(AaCode.AA31_PAYMASTER_DEPOSIT_TOO_LOW);
    expect(err.phase).toBe('paymaster_validation');
  });

  it('routes a non-AA RPC rejection to AaFetchError (RESPONSE_SHAPE)', async () => {
    makeRpcError({ message: 'some unknown bundler rejection' });
    const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
    const err = await provider.submitUserOp(makePackedUserOp(), MOCK_ENTRY_POINT).catch((e) => e);
    expect(err).toBeInstanceOf(AaFetchError);
    expect(err.code).toBe(AaFetchErrorCode.RESPONSE_SHAPE);
  });

  it('routes revert bytes in error.data (no AA prefix) to an execution-phase revert', async () => {
    // Error("execution reverted") encoded — no AA prefix, carries revert data.
    makeRpcError({
      message: 'execution reverted',
      data: '0x08c379a0' + '0'.repeat(120),
    });
    const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
    const err = await provider.submitUserOp(makePackedUserOp(), MOCK_ENTRY_POINT).catch((e) => e);
    expect(err).toBeInstanceOf(UserOpRevertError);
    expect(err.code).toBe(AaCode.UNKNOWN);
    expect(err.phase).toBe('execution');
  });
});

// ---------------------------------------------------------------------------
// Erc4337BundlerProvider with usePimlicoFormat
// ---------------------------------------------------------------------------

describe('Erc4337BundlerProvider with usePimlicoFormat', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('sends packed format by default (usePimlicoFormat=false)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: MOCK_USER_OP_HASH }),
    });

    const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
    const userOp = makePackedUserOp({
      initCode: '0x' + 'AA'.repeat(20) + 'deadbeef', // factory + factoryData
    });

    await provider.submitUserOp(userOp, MOCK_ENTRY_POINT);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const sentUserOp = callBody.params[0];

    // Should have packed fields
    expect(sentUserOp).toHaveProperty('initCode');
    expect(sentUserOp).toHaveProperty('accountGasLimits');
    expect(sentUserOp).toHaveProperty('gasFees');
    expect(sentUserOp).toHaveProperty('paymasterAndData');

    // Should NOT have Pimlico fields
    expect(sentUserOp).not.toHaveProperty('factory');
    expect(sentUserOp).not.toHaveProperty('factoryData');
    expect(sentUserOp).not.toHaveProperty('callGasLimit');
    expect(sentUserOp).not.toHaveProperty('verificationGasLimit');
  });

  it('converts to Pimlico format when usePimlicoFormat=true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: MOCK_USER_OP_HASH }),
    });

    const provider = new Erc4337BundlerProvider({
      rpcUrl: 'https://public.pimlico.io/v2/421614/rpc',
      usePimlicoFormat: true,
    });

    const factoryAddr = '0x' + 'BB'.repeat(20);
    const factoryCalldata = 'cafebabe';
    const userOp = makePackedUserOp({
      initCode: factoryAddr + factoryCalldata,
    });

    await provider.submitUserOp(userOp, MOCK_ENTRY_POINT);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const sentUserOp = callBody.params[0];

    // Should have Pimlico format fields
    expect(sentUserOp).toHaveProperty('factory');
    expect(sentUserOp).toHaveProperty('factoryData');
    expect(sentUserOp).toHaveProperty('callGasLimit');
    expect(sentUserOp).toHaveProperty('verificationGasLimit');
    expect(sentUserOp).toHaveProperty('maxFeePerGas');
    expect(sentUserOp).toHaveProperty('maxPriorityFeePerGas');

    // Should NOT have packed fields
    expect(sentUserOp).not.toHaveProperty('initCode');
    expect(sentUserOp).not.toHaveProperty('accountGasLimits');
    expect(sentUserOp).not.toHaveProperty('gasFees');
    expect(sentUserOp).not.toHaveProperty('paymasterAndData');

    // Verify factory/factoryData split
    expect(sentUserOp.factory.toLowerCase()).toBe(factoryAddr.toLowerCase());
    expect(sentUserOp.factoryData.toLowerCase()).toBe('0x' + factoryCalldata);
  });

  it('does not include factory/factoryData when initCode is empty (usePimlicoFormat=true)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: MOCK_USER_OP_HASH }),
    });

    const provider = new Erc4337BundlerProvider({
      rpcUrl: 'https://public.pimlico.io/v2/421614/rpc',
      usePimlicoFormat: true,
    });

    const userOp = makePackedUserOp({ initCode: '0x' });

    await provider.submitUserOp(userOp, MOCK_ENTRY_POINT);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const sentUserOp = callBody.params[0];

    // No factory fields for deployed account
    expect(sentUserOp.factory).toBeUndefined();
    expect(sentUserOp.factoryData).toBeUndefined();
  });

  it('includes paymaster fields when paymaster is set (usePimlicoFormat=true)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: MOCK_USER_OP_HASH }),
    });

    const provider = new Erc4337BundlerProvider({
      rpcUrl: 'https://public.pimlico.io/v2/421614/rpc',
      usePimlicoFormat: true,
    });

    const paymasterAddr = '0x' + 'CC'.repeat(20);
    const pmVerGas = '00'.repeat(15) + '01'; // 1 in 16 bytes
    const pmPostGas = '00'.repeat(15) + '02'; // 2 in 16 bytes
    const pmData = 'deadbeef';
    const paymasterAndData = paymasterAddr + pmVerGas + pmPostGas + pmData;

    const userOp = makePackedUserOp({ paymasterAndData });

    await provider.submitUserOp(userOp, MOCK_ENTRY_POINT);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const sentUserOp = callBody.params[0];

    expect(sentUserOp.paymaster?.toLowerCase()).toBe(paymasterAddr.toLowerCase());
    expect(sentUserOp).toHaveProperty('paymasterVerificationGasLimit');
    expect(sentUserOp).toHaveProperty('paymasterPostOpGasLimit');
    expect(sentUserOp.paymasterData?.toLowerCase()).toBe('0x' + pmData);
  });

  it('does not include paymaster fields when paymaster is zero address (usePimlicoFormat=true)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: MOCK_USER_OP_HASH }),
    });

    const provider = new Erc4337BundlerProvider({
      rpcUrl: 'https://public.pimlico.io/v2/421614/rpc',
      usePimlicoFormat: true,
    });

    const userOp = makePackedUserOp({ paymasterAndData: '0x' });

    await provider.submitUserOp(userOp, MOCK_ENTRY_POINT);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const sentUserOp = callBody.params[0];

    expect(sentUserOp.paymaster).toBeUndefined();
    expect(sentUserOp.paymasterVerificationGasLimit).toBeUndefined();
    expect(sentUserOp.paymasterPostOpGasLimit).toBeUndefined();
    expect(sentUserOp.paymasterData).toBeUndefined();
  });

  it('returns userOpHash correctly when usePimlicoFormat=true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: MOCK_USER_OP_HASH }),
    });

    const provider = new Erc4337BundlerProvider({
      rpcUrl: 'https://public.pimlico.io/v2/421614/rpc',
      usePimlicoFormat: true,
    });

    const hash = await provider.submitUserOp(makePackedUserOp(), MOCK_ENTRY_POINT);
    expect(hash).toBe(MOCK_USER_OP_HASH);
  });

  it('classifies an AA prefix to UserOpRevertError on RPC error when usePimlicoFormat=true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32602, message: 'AA21 didn\'t pay prefund' },
      }),
    });

    const provider = new Erc4337BundlerProvider({
      rpcUrl: 'https://public.pimlico.io/v2/421614/rpc',
      usePimlicoFormat: true,
    });

    await expect(provider.submitUserOp(makePackedUserOp(), MOCK_ENTRY_POINT))
      .rejects.toMatchObject({ code: AaCode.AA21_INSUFFICIENT_PREFUND });
  });

  it('throws AaFetchError (TRANSPORT) on fetch failure when usePimlicoFormat=true', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const provider = new Erc4337BundlerProvider({
      rpcUrl: 'https://public.pimlico.io/v2/421614/rpc',
      usePimlicoFormat: true,
    });

    await expect(provider.submitUserOp(makePackedUserOp(), MOCK_ENTRY_POINT))
      .rejects.toMatchObject({ code: AaFetchErrorCode.TRANSPORT });
  });
});

// ---------------------------------------------------------------------------
// Erc4337BundlerProvider.estimateUserOpGas
// ---------------------------------------------------------------------------

describe('Erc4337BundlerProvider.estimateUserOpGas', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('sends eth_estimateUserOperationGas and returns gas estimates', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: '2.0',
        id: 1,
        result: {
          preVerificationGas: '0x5208',
          verificationGasLimit: '0x186a0',
          callGasLimit: '0xc350',
        },
      }),
    });

    const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
    const userOp = makePackedUserOp();

    const estimate = await provider.estimateUserOpGas(userOp, MOCK_ENTRY_POINT);

    // normalizeHex pads to even length
    expect(estimate.preVerificationGas).toBe('0x5208');
    expect(estimate.verificationGasLimit).toBe('0x0186a0');  // 0x186a0 → 0x0186a0
    expect(estimate.callGasLimit).toBe('0xc350');

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.method).toBe('eth_estimateUserOperationGas');
    expect(callBody.params[0]).toEqual(userOp);
    expect(callBody.params[1]).toBe(MOCK_ENTRY_POINT);
  });

  it('normalizes odd-length hex strings from Pimlico response', async () => {
    // Pimlico sometimes returns odd-length hex like "0x203ef" instead of "0x0203ef"
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: '2.0',
        id: 1,
        result: {
          preVerificationGas: '0x203ef',  // odd length (5 hex chars)
          verificationGasLimit: '0x1',    // single char
          callGasLimit: '0xabc',          // odd length (3 hex chars)
        },
      }),
    });

    const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
    const estimate = await provider.estimateUserOpGas(makePackedUserOp(), MOCK_ENTRY_POINT);

    // Should be padded to even length
    expect(estimate.preVerificationGas).toBe('0x0203ef');
    expect(estimate.verificationGasLimit).toBe('0x01');
    expect(estimate.callGasLimit).toBe('0x0abc');
  });

  it('converts to Pimlico format when usePimlicoFormat=true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: '2.0',
        id: 1,
        result: {
          preVerificationGas: '0x5208',
          verificationGasLimit: '0x186a0',
          callGasLimit: '0xc350',
        },
      }),
    });

    const provider = new Erc4337BundlerProvider({
      rpcUrl: 'https://public.pimlico.io/v2/421614/rpc',
      usePimlicoFormat: true,
    });

    const factoryAddr = '0x' + 'AA'.repeat(20);
    const factoryCalldata = 'deadbeef';
    const userOp = makePackedUserOp({
      initCode: factoryAddr + factoryCalldata,
    });

    await provider.estimateUserOpGas(userOp, MOCK_ENTRY_POINT);

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const sentUserOp = callBody.params[0];

    // Should have Pimlico format (factory/factoryData instead of initCode)
    expect(sentUserOp).toHaveProperty('factory');
    expect(sentUserOp).toHaveProperty('factoryData');
    expect(sentUserOp).not.toHaveProperty('initCode');
    expect(sentUserOp).not.toHaveProperty('accountGasLimits');
  });

  it('includes paymaster gas limits when present in response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: '2.0',
        id: 1,
        result: {
          preVerificationGas: '0x5208',
          verificationGasLimit: '0x186a0',
          callGasLimit: '0xc350',
          paymasterVerificationGasLimit: '0x7530',
          paymasterPostOpGasLimit: '0x2710',
        },
      }),
    });

    const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
    const estimate = await provider.estimateUserOpGas(makePackedUserOp(), MOCK_ENTRY_POINT);

    expect(estimate.paymasterVerificationGasLimit).toBe('0x7530');
    expect(estimate.paymasterPostOpGasLimit).toBe('0x2710');
  });

  it('omits paymaster gas limits when not present in response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: '2.0',
        id: 1,
        result: {
          preVerificationGas: '0x5208',
          verificationGasLimit: '0x186a0',
          callGasLimit: '0xc350',
        },
      }),
    });

    const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
    const estimate = await provider.estimateUserOpGas(makePackedUserOp(), MOCK_ENTRY_POINT);

    expect(estimate.paymasterVerificationGasLimit).toBeUndefined();
    expect(estimate.paymasterPostOpGasLimit).toBeUndefined();
  });

  it('classifies a predicted revert as UserOpRevertError tagged operation=estimate_user_op_gas', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32000, message: 'AA21: not enough gas' },
      }),
    });

    const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });

    const err = await provider.estimateUserOpGas(makePackedUserOp(), MOCK_ENTRY_POINT).catch((e) => e);
    expect(err).toBeInstanceOf(UserOpRevertError);
    expect(err.code).toBe(AaCode.AA21_INSUFFICIENT_PREFUND);
    // The base operation is what distinguishes a predicted (estimate) revert from a submit rejection.
    expect(err.operation).toBe('estimate_user_op_gas');
  });

  it('throws AaFetchError (TRANSPORT) on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });

    await expect(provider.estimateUserOpGas(makePackedUserOp(), MOCK_ENTRY_POINT))
      .rejects.toMatchObject({ code: AaFetchErrorCode.TRANSPORT });
  });
});

// ---------------------------------------------------------------------------
// getReceipt execution-revert extraction (Erc4337). An execution revert is mined,
// so it is surfaced on the receipt (success:false + revert fields), not thrown.
// Logs are encoded from the real EntryPoint ABI (deterministic selectors).
// ---------------------------------------------------------------------------
describe('Erc4337BundlerProvider.getReceipt — execution-revert extraction', () => {
  const epIface = new ethers.Interface(EntryPointABI);

  beforeEach(() => mockFetch.mockReset());

  // Encodes a real UserOperationRevertReason event log carrying `reasonBytes`.
  function revertLog(reasonBytes: string) {
    const { topics, data } = epIface.encodeEventLog('UserOperationRevertReason', [
      MOCK_USER_OP_HASH,
      '0x' + '11'.repeat(20),
      0n,
      reasonBytes,
    ]);
    return { topics, data };
  }

  function mockReceipt(raw: Record<string, unknown>) {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: raw }) });
  }

  it('leaves revert fields unset on success', async () => {
    mockReceipt({ success: true, receipt: { transactionHash: '0xabc', blockNumber: '0x10' } });
    const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
    const receipt = await provider.getReceipt(MOCK_USER_OP_HASH);
    expect(receipt!.success).toBe(true);
    expect(receipt!.revertReason).toBeUndefined();
    expect(receipt!.contractError).toBeUndefined();
    expect(receipt!.revertSelector).toBeUndefined();
  });

  it('decodes a standard Error(string) revert from the receipt log', async () => {
    const reason = epIface.encodeErrorResult('Error', ['boom']);
    mockReceipt({
      success: false,
      logs: [revertLog(reason)],
      receipt: { transactionHash: '0xabc', blockNumber: '0x10' },
    });
    const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
    const receipt = await provider.getReceipt(MOCK_USER_OP_HASH);
    expect(receipt!.success).toBe(false);
    expect(receipt!.revertReason).toBe(reason);
    expect(receipt!.contractError).toEqual({ name: 'Error', args: ['boom'] });
    expect(receipt!.revertSelector).toBe('0x08c379a0'); // keccak("Error(string)")[:4]
  });

  it('preserves raw bytes + selector for an unknown revert selector (no decode)', async () => {
    const reason = '0xdeadbeef' + '00'.repeat(32);
    mockReceipt({
      success: false,
      logs: [revertLog(reason)],
      receipt: { transactionHash: '0xabc', blockNumber: '0x10' },
    });
    const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
    const receipt = await provider.getReceipt(MOCK_USER_OP_HASH);
    expect(receipt!.success).toBe(false);
    expect(receipt!.revertReason).toBe(reason);
    expect(receipt!.contractError).toBeUndefined();
    expect(receipt!.revertSelector).toBe('0xdeadbeef');
  });

  // Full on-chain path on REAL Base Sepolia receipts: the actual event logs flow
  // through provider.getReceipt → decodeRevertReason (covers the fixtures' `logs`).
  //
  // The expected decode for each captured receipt is stated EXPLICITLY here — not read
  // from the fixture's own `expect` field — so the assertion documents what each sample
  // means and a regenerated/incorrect fixture can't silently pass.
  const expected: Record<string, { revertSelector: string; contractError?: { name: string; args: unknown[] } }> = {
    'ERC20 transfer exceeds balance (standard Error(string))': {
      revertSelector: '0x08c379a0', // keccak("Error(string)")[:4]
      contractError: { name: 'Error', args: ['ERC20: transfer amount exceeds balance'] },
    },
    'OZ FailedCall (in shipped ABI)': {
      revertSelector: '0xd6bda275',
      contractError: { name: 'FailedCall', args: [] },
    },
    // Selectors not in the SDK ABIs → SDK can't decode; raw bytes + selector preserved
    // for the consumer's own ABI, no contractError.
    'unknown target selector 0x1b16c2b3': { revertSelector: '0x1b16c2b3' },
    'unknown target selector 0xe6e287bf': { revertSelector: '0xe6e287bf' },
  };

  it.each(realRevertFixtures)('surfaces the real revert from receipt logs — $note', async (fx) => {
    const want = expected[fx.note];
    expect(want).toBeDefined(); // fixture set changed → add its expectation above

    mockReceipt({
      success: false,
      logs: fx.logs,
      receipt: { transactionHash: fx.txHash, blockNumber: '0x1' },
    });
    const provider = new Erc4337BundlerProvider({ rpcUrl: 'https://bundler.example.com' });
    const receipt = await provider.getReceipt(MOCK_USER_OP_HASH);

    expect(receipt!.success).toBe(false);
    expect(receipt!.revertReason).toBeTruthy(); // the revert log was found & extracted
    expect(receipt!.revertSelector).toBe(want.revertSelector);
    expect(receipt!.contractError).toEqual(want.contractError); // undefined for unknown selectors
  });
});
