import Foundation
import Observation
import ReaderCore

@MainActor @Observable
final class ReaderModel {
  enum Phase { case ready, scanning, loading, result, failed }
  var phase: Phase = .ready
  var result: ReaderResult?
  var error: String?
  private var reader: WalletReader?

  var isBusy: Bool { phase == .scanning || phase == .loading }

  func simulate(address: String, scenario: String) async {
    await perform {
      try await ReaderClient(address: address).simulate(scenario: scenario)
    }
  }

  func resolve(address: String, message: String) async {
    await perform {
      try await ReaderClient(address: address).resolve(message: message)
    }
  }

  func scan(address: String) async {
    await perform {
      guard Bundle.main.object(forInfoDictionaryKey: "VASReaderApproved") as? Bool == true else {
        throw ReaderFailure.server(
          "NFC scanning is awaiting Apple’s VAS reader entitlement and an NFC-enabled Wallet pass. The simulation works without those approvals."
        )
      }
      let client = try ReaderClient(address: address)
      let configuration = try await client.configuration()
      guard configuration.vasReady else {
        throw ReaderFailure.server(
          "The server has not configured Apple VAS decryption. No eligibility inquiry was sent.")
      }
      self.phase = .scanning
      let payload = try await self.readWallet(passTypeIdentifier: configuration.passTypeIdentifier)
      self.phase = .loading
      return try await client.readVAS(payload)
    }
  }

  func reset() {
    reader?.cancel()
    reader = nil
    result = nil
    error = nil
    phase = .ready
  }

  private func perform(_ operation: () async throws -> ReaderResult) async {
    result = nil
    error = nil
    phase = .loading
    do {
      result = try await operation()
      phase = .result
    } catch {
      self.error = error.localizedDescription
      phase = .failed
    }
  }

  private func readWallet(passTypeIdentifier: String) async throws -> VASPayload {
    try await withCheckedThrowingContinuation { continuation in
      let reader = WalletReader(passTypeIdentifier: passTypeIdentifier) { result in
        continuation.resume(with: result)
      }
      self.reader = reader
      do { try reader.start() } catch {
        self.reader = nil
        continuation.resume(throwing: error)
      }
    }
  }
}
