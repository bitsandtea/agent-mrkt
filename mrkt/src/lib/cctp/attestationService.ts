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
  const logPrefix = `[CCTP-ATTESTATION-API]`;

  console.log(`${logPrefix} Fetching attestation for messageHash:`, {
    messageHash,
    apiUrl: `${baseURL}/attestations/${messageHash}`,
    timestamp: new Date().toISOString(),
  });

  try {
    const response = await axiosInstance.get<AttestationResponse>(
      `/attestations/${messageHash}`
    );

    const attestation = mapAttestation(response?.data);

    console.log(`${logPrefix} Attestation API response:`, {
      messageHash,
      status: attestation.status,
      hasMessage: !!attestation.message,
      messagePreview: attestation.message
        ? `${attestation.message.slice(0, 20)}...${attestation.message.slice(
            -10
          )}`
        : null,
    });

    return attestation;
  } catch (error) {
    // Treat 404 as pending and keep polling
    if (axios.isAxiosError(error) && error?.response?.status === 404) {
      console.log(`${logPrefix} Attestation not ready (404) - still pending:`, {
        messageHash,
        status: "pending_confirmations",
      });

      const response = {
        attestation: null,
        status: AttestationStatus.pending_confirmations,
      };
      return mapAttestation(response);
    } else {
      console.error(`${logPrefix} Attestation service error:`, {
        messageHash,
        error: error instanceof Error ? error.message : "Unknown error",
        status: axios.isAxiosError(error) ? error.response?.status : "unknown",
      });
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
  const logPrefix = `[CCTP-ATTESTATION-POLL]`;
  let attempts = 0;

  console.log(`${logPrefix} Starting attestation polling:`, {
    messageHash,
    maxAttempts,
    intervalMs,
    estimatedMaxTime: `${Math.floor(
      (maxAttempts * intervalMs) / 60000
    )} minutes`,
    timestamp: new Date().toISOString(),
  });

  const poll = async () => {
    attempts++;

    console.log(`${logPrefix} Polling attempt ${attempts}/${maxAttempts}:`, {
      messageHash,
      attempt: attempts,
      remainingAttempts: maxAttempts - attempts,
      nextPollIn: `${intervalMs / 1000}s`,
    });

    if (attempts > maxAttempts) {
      console.error(`${logPrefix} ❌ Attestation polling timeout:`, {
        messageHash,
        totalAttempts: attempts - 1,
        totalTimeMs: (attempts - 1) * intervalMs,
        totalTimeMinutes: Math.floor(((attempts - 1) * intervalMs) / 60000),
      });
      onError("Attestation polling timeout");
      return;
    }

    const attestation = await getAttestation(messageHash);

    if (!attestation) {
      console.error(
        `${logPrefix} ❌ Failed to fetch attestation on attempt ${attempts}:`,
        {
          messageHash,
          attempt: attempts,
        }
      );
      onError("Failed to fetch attestation");
      return;
    }

    if (
      attestation.status === AttestationStatus.complete &&
      attestation.message
    ) {
      console.log(`${logPrefix} ✅ Attestation completed successfully:`, {
        messageHash,
        totalAttempts: attempts,
        totalTimeMs: attempts * intervalMs,
        totalTimeMinutes: Math.floor((attempts * intervalMs) / 60000),
        attestationLength: attestation.message.length,
      });
      onComplete(attestation.message);
      return;
    }

    console.log(
      `${logPrefix} Attestation still pending, scheduling next poll:`,
      {
        messageHash,
        status: attestation.status,
        attempt: attempts,
        nextPollIn: `${intervalMs / 1000}s`,
      }
    );

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
