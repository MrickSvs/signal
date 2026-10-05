import { describe, expect, it } from "vitest";
import { missingProperties } from "./notion-setup";

describe("notion:setup (idempotent)", () => {
  it("lists only the properties of SPEC §11.1 the data source lacks", () => {
    expect(missingProperties(["Nom", "ID", "Type", "Statut"])).toEqual([
      "Epic",
      "Insight",
      "MoSCoW",
      "Points",
      "Énoncé",
      "Prototype",
      "Lien Signal",
      "Validé le",
    ]);
    expect(
      missingProperties([
        "Nom",
        "ID",
        "Type",
        "Statut",
        "Epic",
        "Insight",
        "MoSCoW",
        "Points",
        "Énoncé",
        "Prototype",
        "Lien Signal",
        "Validé le",
        "Une colonne ajoutée par l'équipe",
      ]),
    ).toEqual([]);
  });
});
