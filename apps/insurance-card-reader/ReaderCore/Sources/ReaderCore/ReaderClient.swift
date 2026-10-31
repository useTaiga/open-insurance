import Foundation

private struct ErrorBody: Decodable { let error: String }

public struct ReaderConfiguration: Decodable, Sendable {
  public let passTypeIdentifier: String
  public let vasReady: Bool
  public let eligibilityReady: Bool
  public let syntheticOnly: Bool
}

public struct VASPayload: Encodable, Sendable {
  public let passTypeIdentifier: String
  public let vasDataBase64: String
  public let mobileTokenBase64: String

  public init(passTypeIdentifier: String, vasData: Data, mobileToken: Data) {
    self.passTypeIdentifier = passTypeIdentifier
    self.vasDataBase64 = vasData.base64EncodedString()
    self.mobileTokenBase64 = mobileToken.base64EncodedString()
  }
}

public enum ReaderFailure: LocalizedError, Sendable {
  case configuration
  case server(String)
  case response
  public var errorDescription: String? {
    switch self {
    case .configuration:
      return "Enter an HTTPS server address, or a local HTTP address for this synthetic demo."
    case .server(let message): return message
    case .response: return "The server returned an unreadable reader response."
    }
  }
}

public struct ReaderClient: Sendable {
  private let baseURL: URL
  private let session: URLSession

  public init(address: String) throws {
    guard let url = URL(string: address), let scheme = url.scheme,
      ["https", "http"].contains(scheme), url.host != nil, url.user == nil, url.password == nil,
      url.query == nil, url.fragment == nil
    else {
      throw ReaderFailure.configuration
    }
    baseURL = url
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 15
    configuration.urlCache = nil
    session = URLSession(configuration: configuration)
  }

  public func configuration() async throws -> ReaderConfiguration {
    try await request("api/reader/config", body: Optional<String>.none)
  }

  public func simulate(scenario: String) async throws -> ReaderResult {
    try await request("api/reader/simulate", body: ["scenario": scenario])
  }

  public func resolve(message: String) async throws -> ReaderResult {
    try await request("api/reader/read", body: ["message": message])
  }

  public func readVAS(_ payload: VASPayload) async throws -> ReaderResult {
    try await request("api/reader/vas", body: payload)
  }

  private func request<Output: Decodable, Body: Encodable>(_ path: String, body: Body?) async throws
    -> Output
  {
    var request = URLRequest(url: baseURL.appendingPathComponent(path))
    if let body {
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONEncoder().encode(body)
    }
    let (data, response) = try await session.data(for: request)
    guard let response = response as? HTTPURLResponse else { throw ReaderFailure.response }
    guard (200...299).contains(response.statusCode) else {
      let message = try? JSONDecoder().decode(ErrorBody.self, from: data).error
      throw ReaderFailure.server(
        message ?? "The reader server returned HTTP \(response.statusCode).")
    }
    return try JSONDecoder().decode(Output.self, from: data)
  }
}
