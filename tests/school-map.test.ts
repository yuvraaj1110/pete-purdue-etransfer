import { describe, expect, it } from "vitest";
import { domainToSchool, searchSchools } from "../src/school-map";

describe("domainToSchool", () => {
  it("maps ivytech.edu and subdomains", () => {
    expect(domainToSchool("ivytech.edu")?.code).toBe("003825");
    expect(domainToSchool("www.ivytech.edu")?.code).toBe("003825");
    expect(domainToSchool("catalog.ivytech.edu")?.code).toBe("003825");
    expect(domainToSchool("CATALOG.IVYTECH.EDU")?.code).toBe("003825");
  });
  it("returns null for unknown domains (fallback to manual picker)", () => {
    expect(domainToSchool("purdue.edu")).toBeNull();
    expect(domainToSchool("example.com")).toBeNull();
  });
  it("maps the verified out-of-state schools", () => {
    expect(domainToSchool("und.edu")?.code).toBe("006878");
    expect(domainToSchool("catalog.umich.edu")?.code).toBe("001839");
    expect(domainToSchool("www.gatech.edu")?.code).toBe("005248");
  });
});

describe("searchSchools", () => {
  const list = [
    { label: "Ivy Tech Community College-IN", value: "003825" },
    { label: "Ball State Univ Muncie-IN", value: "001051" },
  ];
  it("filters case-insensitively", () => {
    expect(searchSchools(list, "ivy")).toHaveLength(1);
    expect(searchSchools(list, "BALL")).toHaveLength(1);
    expect(searchSchools(list, "")).toHaveLength(2);
  });
});
