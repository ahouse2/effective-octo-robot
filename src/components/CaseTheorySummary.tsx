import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface CaseTheory {
  factPatterns: string[];
  legalArguments: string[];
  potentialOutcomes: string[];
  status: "initial" | "developing" | "refined" | "complete";
}

// Mock data for an evolving case theory
const mockCaseTheory: CaseTheory = {
  factPatterns: [
    "Parties married on 2010-05-15, separated on 2023-01-20.",
    "Two minor children: Alice (8) and Bob (5).",
    "Primary residence acquired during marriage, currently occupied by Mother and children.",
    "Father's income: $120,000/year (salaried). Mother's income: $60,000/year (freelance, variable).",
    "Discrepancy noted in Father's Q2 2023 income reporting.",
  ],
  legalArguments: [
    "Child custody: Best interest of the child standard, considering parental roles and stability.",
    "Community property: Equal division of assets acquired during marriage, including primary residence and retirement accounts.",
    "Spousal support: Analysis based on Family Code § 4320 factors, considering marriage duration and earning capacities.",
  ],
  potentialOutcomes: [
    "Joint legal and physical custody likely, with primary residence to Mother.",
    "Equal division of community property, requiring valuation of assets.",
    "Spousal support for Mother, duration and amount to be determined based on detailed financial analysis.",
  ],
  status: "developing",
};

export const CaseTheorySummary: React.FC = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Current Case Theory</CardTitle>
        <CardDescription>The evolving legal theory compiled by the agents.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4 text-sm text-muted-foreground">
          <div>
            <h3 className="font-semibold text-foreground mb-1">Fact Patterns:</h3>
            {mockCaseTheory.factPatterns.length > 0 ? (
              <ul className="list-disc list-inside space-y-1">
                {mockCaseTheory.factPatterns.map((fact, index) => (
                  <li key={index}>{fact}</li>
                ))}
              </ul>
            ) : (
              <p>[Awaiting analysis...]</p>
            )}
          </div>
          <Separator />
          <div>
            <h3 className="font-semibold text-foreground mb-1">Legal Arguments:</h3>
            {mockCaseTheory.legalArguments.length > 0 ? (
              <ul className="list-disc list-inside space-y-1">
                {mockCaseTheory.legalArguments.map((arg, index) => (
                  <li key={index}>{arg}</li>
                ))}
              </ul>
            ) : (
              <p>[Awaiting analysis...]</p>
            )}
          </div>
          <Separator />
          <div>
            <h3 className="font-semibold text-foreground mb-1">Potential Outcomes:</h3>
            {mockCaseTheory.potentialOutcomes.length > 0 ? (
              <ul className="list-disc list-inside space-y-1">
                {mockCaseTheory.potentialOutcomes.map((outcome, index) => (
                  <li key={index}>{outcome}</li>
                ))}
              </ul>
            ) : (
              <p>[Awaiting analysis...]</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};