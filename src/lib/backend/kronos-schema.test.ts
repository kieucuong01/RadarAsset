import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

function fields(name: string) {
  const model = Prisma.dmmf.datamodel.models.find((item) => item.name === name);
  expect(model, `${name} must exist`).toBeDefined();
  return model!.fields.map((field) => field.name);
}

describe("Kronos shadow provenance schema", () => {
  it("records point-in-time forecast provenance and realized outcomes", () => {
    expect(fields("ForecastPoint")).toEqual(
      expect.arrayContaining([
        "forecastFor",
        "status",
        "methodologyVersion",
        "modelRevision",
        "inputFingerprint",
        "realizedPrice",
        "evaluatedAt",
      ]),
    );
  });

  it("links shadow evaluations to the originating research run", () => {
    expect(fields("ModelEvaluation")).toEqual(
      expect.arrayContaining([
        "researchRunId",
        "status",
        "methodologyVersion",
        "dataFingerprint",
        "researchRun",
      ]),
    );
    expect(fields("ResearchRun")).toContain("evaluations");
  });
});
