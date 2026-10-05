import { isRestartable } from "./useRestartWorkload";
import { isScalable } from "./useScaleWorkload";

describe("isRestartable", () => {
  it("accepts the kinds with a pod template to stamp", () => {
    expect(isRestartable("Deployment")).toBe(true);
    expect(isRestartable("StatefulSet")).toBe(true);
    expect(isRestartable("DaemonSet")).toBe(true);
  });

  // The one case where restartable and scalable genuinely differ: a DaemonSet
  // has no scale subresource but does own a pod template, so it rolls fine.
  // Reusing `isScalable` for the restart button would have hidden it.
  it("accepts DaemonSet even though it cannot scale", () => {
    expect(isRestartable("DaemonSet")).toBe(true);
    expect(isScalable("DaemonSet")).toBe(false);
  });

  // A ReplicaSet scales, but restarting one is wrong: its template is owned
  // by the Deployment above it, which would immediately revert the patch.
  it("rejects ReplicaSet, whose template its owner controls", () => {
    expect(isRestartable("ReplicaSet")).toBe(false);
  });

  it("rejects kinds with no pod template", () => {
    expect(isRestartable("Pod")).toBe(false);
    expect(isRestartable("ConfigMap")).toBe(false);
    expect(isRestartable("Service")).toBe(false);
  });

  // `kind` is threaded through from a route param and may be absent.
  it("tolerates missing input", () => {
    expect(isRestartable(undefined)).toBe(false);
    expect(isRestartable("")).toBe(false);
  });

  // Guards against a prototype key being read as a supported kind.
  it("does not treat inherited object properties as kinds", () => {
    expect(isRestartable("constructor")).toBe(false);
    expect(isRestartable("toString")).toBe(false);
  });
});
