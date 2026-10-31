import Foundation

public indirect enum JSONValue: Codable, Sendable, Equatable {
  case object([String: JSONValue])
  case array([JSONValue])
  case string(String)
  case number(Double)
  case bool(Bool)
  case null

  public init(from decoder: any Decoder) throws {
    let value = try decoder.singleValueContainer()
    if value.decodeNil() {
      self = .null
    } else if let object = try? value.decode([String: JSONValue].self) {
      self = .object(object)
    } else if let array = try? value.decode([JSONValue].self) {
      self = .array(array)
    } else if let string = try? value.decode(String.self) {
      self = .string(string)
    } else if let boolean = try? value.decode(Bool.self) {
      self = .bool(boolean)
    } else {
      self = .number(try value.decode(Double.self))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var value = encoder.singleValueContainer()
    switch self {
    case .object(let object): try value.encode(object)
    case .array(let array): try value.encode(array)
    case .string(let string): try value.encode(string)
    case .number(let number): try value.encode(number)
    case .bool(let boolean): try value.encode(boolean)
    case .null: try value.encodeNil()
    }
  }

  public var prettyPrinted: String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    guard let data = try? encoder.encode(self), let text = String(data: data, encoding: .utf8)
    else { return "Unavailable" }
    return text
  }
}

public struct ReaderResult: Decodable, Sendable {
  public enum Mode: String, Decodable, Sendable { case simulation, prepared }
  public let mode: Mode
  public let sent: Bool
  public let memberName: String
  public let request: JSONValue
  public let eligibility: Eligibility?

  enum CodingKeys: String, CodingKey { case mode, sent, memberName, request, eligibility }

  public init(from decoder: any Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    mode = try values.decode(Mode.self, forKey: .mode)
    sent = try values.decode(Bool.self, forKey: .sent)
    memberName = try values.decode(String.self, forKey: .memberName)
    request = try values.decode(JSONValue.self, forKey: .request)
    eligibility = try values.decodeIfPresent(Eligibility.self, forKey: .eligibility)
    guard !sent, mode == .simulation || eligibility == nil,
      mode != .simulation || eligibility != nil
    else {
      throw DecodingError.dataCorrupted(
        .init(
          codingPath: decoder.codingPath,
          debugDescription:
            "The demo response mixes simulated coverage with a submitted or prepared inquiry."))
    }
  }
}

public struct Eligibility: Decodable, Sendable {
  public enum Status: String, Decodable, Sendable {
    case active = "ACTIVE"
    case inactive = "INACTIVE"
    case unknown = "UNKNOWN"
  }
  public struct Plan: Decodable, Sendable {
    public let name: String?
    public let payerName: String?
    public let memberId: String?
    public let groupNumber: String?
    public let insuranceType: String?
    public let startDate: String?
    public let endDate: String?
  }
  public struct Benefit: Decodable, Sendable {
    public let name: String
    public let code: String?
    public let amount: String?
    public let percent: String?
    public let coverageLevel: String?
    public let network: String?
    public let timeQualifier: String?
    public let quantity: String?
    public let quantityQualifier: String?
    public let serviceTypeCodes: [String]
    public let serviceTypes: [String]
    public let notes: [String]

    public var displayValue: String {
      if let amount, let value = Decimal(string: amount, locale: Locale(identifier: "en_US_POSIX"))
      {
        return value.formatted(.currency(code: "USD"))
      }
      if let percent,
        let value = Decimal(string: percent, locale: Locale(identifier: "en_US_POSIX"))
      {
        return value.formatted(.percent)
      }
      return amount ?? percent ?? "See details"
    }
  }
  public struct PayerError: Decodable, Sendable {
    public let code: String?
    public let description: String
    public let resolution: String?
  }
  public let status: Status
  public let plan: Plan
  public let benefits: [Benefit]
  public let errors: [PayerError]

  public var statusLabel: String {
    guard errors.isEmpty else { return "Needs review" }
    switch status {
    case .active: return "Active coverage"
    case .inactive: return "Inactive coverage"
    case .unknown: return "Coverage unknown"
    }
  }
}
