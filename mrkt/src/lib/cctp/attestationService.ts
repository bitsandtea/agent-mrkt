import axios from "axios";
import { IRIS_ATTESTATION_API_URL } from "../../config/tokens";

export enum AttestationStatus {
  complete = "complete",
  pending_confirmations = "pending_confirmations",
}

export interface AttestationResponse {
  attestation: string | null;
  status: AttestationStatus;
}

export interface Attestation {
  message: string | null;
  status: AttestationStatus;
}

const mapAttestation = (
  attestationResponse: AttestationResponse
): Attestation => ({
  message: attestationResponse.attestation,
  status: attestationResponse.status,
});

const baseURL = `${IRIS_ATTESTATION_API_URL}`;
const axiosInstance = axios.create({ baseURL });

/**
 * Get attestation for a message hash from Circle's CCTP v2 API
 * @param transactionHash The transaction hash from the CCTP burn transaction
 * @param sourceDomain The source domain ID
 * @returns Attestation data or null if error
 */
export const getAttestationV2 = async (
  transactionHash: string,
  sourceDomain: number
): Promise<Attestation | null> => {
  try {
    const url = `/v2/messages/${sourceDomain}?transactionHash=${transactionHash}`;
    const response = await axiosInstance.get(url);

    if (response.data?.messages?.[0]?.status === "complete") {
      return {
        message: response.data.messages[0].attestation,
        status: AttestationStatus.complete,
      };
    } else {
      return {
        message: null,
        status: AttestationStatus.pending_confirmations,
      };
    }
  } catch (error) {
    // Treat 404 as pending and keep polling
    if (axios.isAxiosError(error) && error?.response?.status === 404) {
      return {
        message: null,
        status: AttestationStatus.pending_confirmations,
      };
    } else {
      console.error("Attestation service error:", error);
      return null;
    }
  }
};

/**
 * Legacy v1 API support - Get attestation for a message hash
 * @param messageHash The message hash from the CCTP transaction
 * @returns Attestation data or null if error
 */
export const getAttestation = async (
  messageHash: string
): Promise<Attestation | null> => {
  try {
    const response = await axiosInstance.get<AttestationResponse>(
      `/attestations/${messageHash}`
    );
    return mapAttestation(response?.data);
  } catch (error) {
    // Treat 404 as pending and keep polling
    if (axios.isAxiosError(error) && error?.response?.status === 404) {
      const response = {
        attestation: null,
        status: AttestationStatus.pending_confirmations,
      };
      return mapAttestation(response);
    } else {
      console.error("Attestation service error:", error);
      return null;
    }
  }
};

/**
 * Poll for attestation completion using v2 API with transaction hash
 * @param transactionHash The transaction hash from the CCTP burn transaction
 * @param sourceDomain The source domain ID
 * @param onComplete Callback when attestation is complete
 * @param onError Callback when polling fails
 * @param maxAttempts Maximum number of polling attempts
 * @param intervalMs Polling interval in milliseconds
 */
export const pollAttestationV2 = async (
  transactionHash: string,
  sourceDomain: number,
  onComplete: (attestation: { message: string; attestation: string }) => void,
  onError: (error: string) => void,
  maxAttempts: number = 30,
  intervalMs: number = 5000 // v2 API is slower, use 5s intervals
): Promise<void> => {
  let attempts = 0;

  const poll = async () => {
    if (attempts >= maxAttempts) {
      onError("Attestation polling timeout");
      return;
    }

    try {
      const url = `/v2/messages/${sourceDomain}?transactionHash=${transactionHash}`;
      const response = await axiosInstance.get(url);

      if (response.data?.messages?.[0]?.status === "complete") {
        onComplete(response.data.messages[0]);
        return;
      }

      attempts++;
      setTimeout(poll, intervalMs);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        attempts++;
        setTimeout(poll, intervalMs);
        return;
      }
      onError(
        `Attestation error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  };

  poll();
};

/**
 * Poll for attestation completion with callbacks (v1 API)
 * @param messageHash The message hash to poll for
 * @param onComplete Callback when attestation is complete
 * @param onError Callback when polling fails
 * @param maxAttempts Maximum number of polling attempts
 * @param intervalMs Polling interval in milliseconds
 */
export const pollAttestation = async (
  messageHash: string,
  onComplete: (attestation: string) => void,
  onError: (error: string) => void,
  maxAttempts: number = 30,
  intervalMs: number = 2000
): Promise<void> => {
  let attempts = 0;

  const poll = async () => {
    if (attempts >= maxAttempts) {
      onError("Attestation polling timeout");
      return;
    }

    const attestation = await getAttestation(messageHash);

    if (!attestation) {
      onError("Failed to fetch attestation");
      return;
    }

    if (
      attestation.status === AttestationStatus.complete &&
      attestation.message
    ) {
      onComplete(attestation.message);
      return;
    }

    attempts++;
    setTimeout(poll, intervalMs);
  };

  poll();
};

/**
 * Poll for attestation with Promise-based API (v2)
 * @param transactionHash The transaction hash to poll for
 * @param sourceDomain The source domain ID
 * @param maxAttempts Maximum number of polling attempts
 * @param intervalMs Polling interval in milliseconds
 * @returns Promise that resolves with attestation or rejects with error
 */
export const pollAttestationV2Promise = (
  transactionHash: string,
  sourceDomain: number,
  maxAttempts: number = 30,
  intervalMs: number = 5000
): Promise<{ message: string; attestation: string }> => {
  return new Promise((resolve, reject) => {
    pollAttestationV2(
      transactionHash,
      sourceDomain,
      (attestation) => resolve(attestation),
      (error) => reject(new Error(error)),
      maxAttempts,
      intervalMs
    );
  });
};

/**
 * Poll for attestation with Promise-based API (v1)
 * @param messageHash The message hash to poll for
 * @param maxAttempts Maximum number of polling attempts
 * @param intervalMs Polling interval in milliseconds
 * @returns Promise that resolves with attestation or rejects with error
 */
export const pollAttestationPromise = (
  messageHash: string,
  maxAttempts: number = 30,
  intervalMs: number = 2000
): Promise<string> => {
  return new Promise((resolve, reject) => {
    pollAttestation(
      messageHash,
      (attestation) => resolve(attestation),
      (error) => reject(new Error(error)),
      maxAttempts,
      intervalMs
    );
  });
};
