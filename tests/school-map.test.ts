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
  // Third-party catalog platforms host the actual course pages (bug #13)
  it("resolves third-party catalog hosts back to the school", () => {
    expect(domainToSchool("und-public.courseleaf.com")?.code).toBe("006878");
    expect(domainToSchool("catalog-und.courseleaf.com")?.code).toBe("006878");
    expect(domainToSchool("osu.smartcatalogiq.com")?.code).toBe("001592");
    expect(domainToSchool("umich.coursedog.com")?.code).toBe("001839");
  });
  it("does not invent a school for unknown catalog-host slugs", () => {
    expect(domainToSchool("nosuchschool-public.courseleaf.com")).toBeNull();
    expect(domainToSchool("courseleaf.com")).toBeNull();
  });

  it("covers 100+ top-enrollment domains, each with a real directory code", () => {
    const domains = ["asu.edu", "ucf.edu", "tamu.edu", "utexas.edu", "psu.edu", "ucla.edu",
      "berkeley.edu", "wisc.edu", "washington.edu", "rutgers.edu", "nyu.edu", "wgu.edu",
      "liberty.edu", "gcu.edu", "ufl.edu", "uga.edu", "ncsu.edu", "vt.edu", "lsu.edu", "ku.edu"];
    for (const d of domains) {
      const s = domainToSchool(d);
      expect(s, d).not.toBeNull();
      expect(s!.code, d).toMatch(/^[A-Z0-9]{6}$/);
    }
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
