import ReaderCore
import SwiftUI

struct ReaderView: View {
  @State private var model = ReaderModel()
  @AppStorage("readerServer") private var address = "http://localhost:4320"
  @State private var scenario = "active"
  @State private var reference = ""
  @State private var showSettings = false
  private let pine = Color(red: 0.08, green: 0.27, blue: 0.23)

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          Text("SYNTHETIC DEMO · NO LIVE INQUIRIES")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.secondary)
          if let result = model.result {
            resultView(result)
          } else {
            readyView
          }
          if let error = model.error {
            Text(error).font(.callout).foregroundStyle(.red)
              .accessibilityLabel("Reader error: \(error)")
          }
          if model.isBusy {
            ProgressView(
              model.phase == .scanning
                ? "Waiting for a Wallet card…" : "Connecting to the reader server…")
          }
          controls
        }
        .padding(24)
      }
      .background(Color(.systemGroupedBackground))
      .navigationTitle("Insurance Reader")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        Button("Connection") { showSettings = true }
          .disabled(model.isBusy)
      }
      .sheet(isPresented: $showSettings) { connectionView }
    }
    .tint(pine)
  }

  private var readyView: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Ready to scan").font(.largeTitle.bold())
      Text("Present an insurance card. See the plan and benefits here.")
        .font(.title3).foregroundStyle(.secondary)
      VStack(alignment: .leading, spacing: 12) {
        Text("iPhone → iPhone").font(.headline)
        Text(
          "Open the insurance pass in the other iPhone’s Wallet, then hold the tops of the phones together while this app scans."
        )
        Text("NFC approval pending").font(.caption.weight(.semibold))
        Text("Try a simulated read below to preview the complete results screen.")
          .font(.callout).foregroundStyle(.secondary)
      }
      .padding(20).frame(maxWidth: .infinity, alignment: .leading)
      .background(.background, in: RoundedRectangle(cornerRadius: 20))
    }
  }

  private var controls: some View {
    VStack(alignment: .leading, spacing: 16) {
      Button {
        Task { await model.scan(address: address) }
      } label: {
        Text("Scan Wallet card").frame(maxWidth: .infinity).frame(minHeight: 44)
      }
      .buttonStyle(.borderedProminent)
      .disabled(model.isBusy)
      Picker("Simulation response", selection: $scenario) {
        Text("Active").tag("active")
        Text("Inactive").tag("inactive")
        Text("Rejected").tag("rejected")
      }
      .pickerStyle(.segmented)
      .disabled(model.isBusy)
      Button {
        Task { await model.simulate(address: address, scenario: scenario) }
      } label: {
        Text("Simulate card read").frame(maxWidth: .infinity).frame(minHeight: 44)
      }
      .buttonStyle(.bordered)
      .disabled(model.isBusy)
      DisclosureGroup("Resolve a demo reference") {
        VStack(alignment: .leading, spacing: 12) {
          Text(
            "Paste a reference issued by your local demo. This prepares an inquiry without sending it."
          )
          .font(.caption).foregroundStyle(.secondary)
          TextField("ic1_…", text: $reference)
            .font(.system(.caption, design: .monospaced))
            .textInputAutocapitalization(.never).autocorrectionDisabled()
            .textFieldStyle(.roundedBorder)
          Button("Prepare inquiry") {
            Task { await model.resolve(address: address, message: reference) }
          }
          .frame(minHeight: 44)
          .disabled(reference.isEmpty || model.isBusy)
        }.padding(.top, 12)
      }
      if model.result != nil || model.error != nil {
        Button("Start over") { model.reset() }.frame(minHeight: 44).disabled(model.isBusy)
      }
      Text(
        "Simulation results are invented examples. A prepared inquiry has no coverage result. No amount shown is an amount due."
      )
      .font(.caption).foregroundStyle(.secondary)
    }
  }

  @ViewBuilder private func resultView(_ result: ReaderResult) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(result.memberName).font(.largeTitle.bold())
      Text(
        result.mode == .simulation
          ? "SIMULATED RESULT · NOT PAYER VERIFIED" : "INQUIRY PREPARED · NOT SENT"
      )
      .font(.caption.weight(.bold)).foregroundStyle(.orange)
      if let eligibility = result.eligibility {
        Text(eligibility.statusLabel).font(.title2.weight(.semibold))
        VStack(alignment: .leading, spacing: 12) {
          labeled("Plan", eligibility.plan.name)
          labeled("Payer", eligibility.plan.payerName)
          labeled("Member ID", eligibility.plan.memberId)
          labeled("Group", eligibility.plan.groupNumber)
          labeled("Plan type", eligibility.plan.insuranceType)
          labeled("Start date", eligibility.plan.startDate)
          labeled("End date", eligibility.plan.endDate)
        }
        ForEach(Array(eligibility.errors.enumerated()), id: \.offset) { _, error in
          VStack(alignment: .leading, spacing: 8) {
            Text(error.description).font(.headline)
            if let code = error.code { Text("Payer code \(code)").font(.caption) }
            if let resolution = error.resolution { Text(resolution).font(.callout) }
          }
        }
        if !eligibility.benefits.isEmpty {
          Text("Benefits").font(.title2.weight(.semibold)).padding(.top, 8)
          ForEach(Array(eligibility.benefits.enumerated()), id: \.offset) { _, benefit in
            benefitView(benefit)
          }
        }
      } else {
        Text(
          "The card was resolved and its Stedi request was prepared. Coverage has not been checked."
        )
        .foregroundStyle(.secondary)
      }
      DisclosureGroup("Exact Stedi request") {
        ScrollView(.horizontal) {
          Text(result.request.prettyPrinted)
            .font(.system(.caption, design: .monospaced)).textSelection(.enabled)
        }.padding(.top, 12)
      }
    }
  }

  private func benefitView(_ benefit: Eligibility.Benefit) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        Text(benefit.name).font(.headline)
        Spacer()
        Text(benefit.displayValue).font(.title3.weight(.semibold)).monospacedDigit()
      }
      Text(benefit.serviceTypes.joined(separator: ", ")).font(.callout)
      if let time = benefit.timeQualifier { Text(time).font(.caption).foregroundStyle(.secondary) }
      labeled("Coverage", benefit.coverageLevel)
      labeled("In network", benefit.network)
      labeled("Quantity", benefit.quantity)
      labeled("Quantity basis", benefit.quantityQualifier)
      ForEach(benefit.notes, id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary) }
    }
    .padding(20).frame(maxWidth: .infinity, alignment: .leading)
    .background(.background, in: RoundedRectangle(cornerRadius: 20))
  }

  @ViewBuilder private func labeled(_ label: String, _ value: String?) -> some View {
    if let value {
      LabeledContent(label) { Text(value).textSelection(.enabled) }
        .font(.callout)
    }
  }

  private var connectionView: some View {
    NavigationStack {
      Form {
        Section("Demo server") {
          TextField("Server address", text: $address)
            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
          Text(
            "Simulator can reach http://localhost:4320 on the Mac. A physical iPhone needs an address reachable through your private connection."
          )
          .font(.caption)
        }
        Section("Prototype") {
          Text(
            "Use synthetic data only. This server does not authenticate a clinic or send eligibility inquiries."
          )
          Text(
            "NFC scanning requires Apple’s VAS entitlement, an NFC-enabled pass, and server-side decryption."
          )
        }
      }
      .navigationTitle("Connection")
      .toolbar { Button("Done") { showSettings = false } }
    }
  }
}
