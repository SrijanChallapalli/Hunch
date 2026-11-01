import { expect } from "chai";
import { relative } from "../../frontend/lib/format";

// Market cards and the market page show deadlines through relative(); pin the
// boundaries so "0m ago" or a rounded-up "60m" can't creep back in.
describe("Frontend relative time formatting", () => {
  const now = 1_700_000_000;

  it("collapses anything under a minute", () => {
    expect(relative(now, now)).to.equal("in <1m");
    expect(relative(now + 59, now)).to.equal("in <1m");
    expect(relative(now - 59, now)).to.equal("just now");
  });

  it("floors to the unit instead of rounding up", () => {
    expect(relative(now + 60, now)).to.equal("in 1m");
    expect(relative(now + 3599, now)).to.equal("in 59m");
    expect(relative(now + 3600, now)).to.equal("in 1h");
    expect(relative(now + 86399, now)).to.equal("in 23h");
    expect(relative(now + 86400, now)).to.equal("in 1d");
  });

  it("formats the past with 'ago'", () => {
    expect(relative(now - 90, now)).to.equal("1m ago");
    expect(relative(now - 7200, now)).to.equal("2h ago");
    expect(relative(now - 3 * 86400, now)).to.equal("3d ago");
  });
});
