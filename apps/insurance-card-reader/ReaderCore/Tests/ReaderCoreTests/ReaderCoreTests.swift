import Foundation
import ReaderCore
import XCTest

final class ReaderCoreTests: XCTestCase {
  private let example = """
    {"mode":"simulation","sent":false,"memberName":"JAMIE MORGAN","request":{"subscriber":{"memberId":"0000123456","groupNumber":"000987"}},"eligibility":{"status":"ACTIVE","plan":{"memberId":"0000123456","groupNumber":"000987"},"benefits":[{"name":"Co-Payment","amount":"0.00","network":"Yes","timeQualifier":"Visit","serviceTypeCodes":["98"],"serviceTypes":["Office visit"],"notes":[]},{"name":"Deductible","serviceTypeCodes":["30"],"serviceTypes":[],"notes":[]}],"errors":[]}}
    """

  func testWirePreservesMemberIDsAndDoesNotTurnMissingAmountsIntoZero() throws {
    let result = try JSONDecoder().decode(ReaderResult.self, from: Data(example.utf8))
    XCTAssertEqual(result.eligibility?.plan.memberId, "0000123456")
    XCTAssertEqual(result.eligibility?.plan.groupNumber, "000987")
    XCTAssertEqual(result.eligibility?.benefits.first?.displayValue, "$0.00")
    XCTAssertEqual(result.eligibility?.benefits.last?.displayValue, "See details")
    XCTAssertEqual(result.eligibility?.benefits.first?.network, "Yes")
    XCTAssertEqual(result.eligibility?.benefits.first?.timeQualifier, "Visit")
    let roundTrip = try JSONDecoder().decode(
      JSONValue.self, from: Data(result.request.prettyPrinted.utf8))
    XCTAssertEqual(roundTrip, result.request)
    XCTAssertTrue(result.request.prettyPrinted.contains("0000123456"))
  }

  func testPreparedAndSubmittedRequestsCannotBeDisplayedAsSimulatedCoverage() throws {
    for invalid in [
      example.replacingOccurrences(of: "\"simulation\"", with: "\"prepared\""),
      example.replacingOccurrences(of: "\"sent\":false", with: "\"sent\":true"),
      example.replacingOccurrences(of: "\"simulation\"", with: "\"live\""),
    ] {
      XCTAssertThrowsError(try JSONDecoder().decode(ReaderResult.self, from: Data(invalid.utf8)))
    }
    let prepared = Data(
      "{\"mode\":\"prepared\",\"sent\":false,\"memberName\":\"JAMIE MORGAN\",\"request\":{}}".utf8)
    XCTAssertNil(try JSONDecoder().decode(ReaderResult.self, from: prepared).eligibility)
  }

  func testPayerErrorsOverrideAnActiveFlag() throws {
    let rejected = example.replacingOccurrences(
      of: "\"errors\":[]",
      with: "\"errors\":[{\"code\":\"75\",\"description\":\"Subscriber not found\"}]")
    let result = try JSONDecoder().decode(ReaderResult.self, from: Data(rejected.utf8))
    XCTAssertEqual(result.eligibility?.statusLabel, "Needs review")
  }

  func testNativeClientAgainstRunningDemoServer() async throws {
    guard let address = ProcessInfo.processInfo.environment["READER_TEST_SERVER_URL"] else {
      throw XCTSkip("Run ios:test:integration with the local demo server running.")
    }
    let client = try ReaderClient(address: address)
    let configuration = try await client.configuration()
    XCTAssertFalse(configuration.vasReady)
    XCTAssertFalse(configuration.eligibilityReady)
    for (scenario, status) in [
      ("active", "Active coverage"), ("inactive", "Inactive coverage"),
      ("rejected", "Needs review"),
    ] {
      let result = try await client.simulate(scenario: scenario)
      XCTAssertEqual(result.mode, .simulation)
      XCTAssertFalse(result.sent)
      XCTAssertEqual(result.memberName, "JAMIE MORGAN")
      XCTAssertEqual(result.eligibility?.statusLabel, status)
      XCTAssertEqual(result.eligibility?.plan.memberId, "0000123456")
    }
    struct State: Decodable {
      struct Card: Decodable { let message: String }
      let currentCard: Card
    }
    let (data, _) = try await URLSession.shared.data(
      from: URL(string: address)!.appendingPathComponent("api/state"))
    let state = try JSONDecoder().decode(State.self, from: data)
    let prepared = try await client.resolve(message: state.currentCard.message)
    XCTAssertEqual(prepared.mode, .prepared)
    XCTAssertNil(prepared.eligibility)
    XCTAssertFalse(prepared.sent)
    do {
      _ = try await client.resolve(message: "ic1_invalid")
      XCTFail("An invalid card should not produce coverage.")
    } catch {
      XCTAssertTrue(error.localizedDescription.contains("Invalid insurance card reference"))
    }
    do {
      _ = try await client.readVAS(
        VASPayload(
          passTypeIdentifier: configuration.passTypeIdentifier, vasData: Data([1, 2]),
          mobileToken: Data()))
      XCTFail("Unconfigured VAS must fail without simulation fallback.")
    } catch {
      XCTAssertTrue(error.localizedDescription.contains("decryption is not configured"))
    }
  }
}
