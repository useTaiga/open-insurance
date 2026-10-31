@preconcurrency import CoreNFC
import ReaderCore

@MainActor
final class WalletReader: NSObject, NFCVASReaderSessionDelegate {
  private let passTypeIdentifier: String
  private let completion: @MainActor (Result<VASPayload, Error>) -> Void
  private var session: NFCVASReaderSession?
  private var finished = false

  init(
    passTypeIdentifier: String, completion: @escaping @MainActor (Result<VASPayload, Error>) -> Void
  ) {
    self.passTypeIdentifier = passTypeIdentifier
    self.completion = completion
  }

  func start() throws {
    guard NFCReaderSession.readingAvailable else {
      throw ReaderFailure.server(
        "NFC scanning requires a supported physical iPhone. Use the simulation in Simulator.")
    }
    let configuration = NFCVASCommandConfiguration(
      vasMode: .normal, passTypeIdentifier: passTypeIdentifier, url: nil)
    session = NFCVASReaderSession(
      vasCommandConfigurations: [configuration], delegate: self, queue: .main)
    session?.alertMessage =
      "Hold the top of this iPhone near the insurance card in the other iPhone’s Wallet."
    session?.begin()
  }

  func cancel() {
    finished = true
    session?.invalidate()
    session = nil
  }

  nonisolated func readerSession(
    _ session: NFCVASReaderSession, didReceive responses: [NFCVASResponse]
  ) {
    guard let response = responses.first else { return }
    let data = response.vasData
    let token = response.mobileToken
    let status = response.status
    Task { @MainActor in
      guard !self.finished else { return }
      self.finished = true
      if status == .success {
        self.session?.invalidate()
        self.completion(
          .success(
            VASPayload(
              passTypeIdentifier: self.passTypeIdentifier, vasData: data, mobileToken: token)))
      } else {
        self.session?.invalidate(errorMessage: "The Wallet card could not be read.")
        self.completion(
          .failure(
            ReaderFailure.server(
              "The Wallet card returned NFC status \(String(status.rawValue, radix: 16)). Unlock the presenting iPhone and select the matching pass."
            )))
      }
      self.session = nil
    }
  }

  nonisolated func readerSession(
    _ session: NFCVASReaderSession, didInvalidateWithError error: Error
  ) {
    let description = error.localizedDescription
    Task { @MainActor in
      guard !self.finished else { return }
      self.finished = true
      self.session = nil
      self.completion(.failure(ReaderFailure.server(description)))
    }
  }
}
