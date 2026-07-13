/**
 * Build src/domain-map.json: domain -> Purdue directory entry, for the highest-
 * enrollment US schools (plus Indiana locals). Every entry is pinned to an exact
 * name substring from src/school-index.json and must resolve to EXACTLY ONE
 * directory row (state-filtered) or it is reported and skipped — no guessing.
 *
 * Known absent from Purdue's directory (verified 2026-07-13, so no mapping is
 * possible): SNHU, Walden, UCSB, UNC Chapel Hill, UNC Charlotte, USC-Columbia.
 *   node scripts/build-domain-map.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const index = JSON.parse(readFileSync("src/school-index.json", "utf8"));

// [domain, state, exact name substring (case-insensitive, must be unique in state)]
const PINS = [
  // Indiana locals
  ["ivytech.edu", "IN", "Ivy Tech Community College-IN"],
  ["iu.edu", "IN", "Indiana University Bloomington"],
  ["iupui.edu", "IN", "Indiana University Indianapolis"],
  ["indstate.edu", "IN", "Indiana State Univ Terre Haute"],
  ["bsu.edu", "IN", "Ball State Univ Muncie-IN"],
  ["butler.edu", "IN", "Butler Univ Indianapolis-IN"],
  ["usi.edu", "IN", "Univ of Southern Indiana"],
  ["uindy.edu", "IN", "Univ of Indianapolis-IN"],
  ["nd.edu", "IN", "Univ of Notre Dame-IN"],
  ["vinu.edu", "IN", "Vincennes University-IN"],
  ["wgu.edu", "IN", "Western Governors Univ-IN"], // WGU lists under Indiana
  // online giants
  ["phoenix.edu", "AZ", "University of Phoenix-AZ"],
  ["gcu.edu", "AZ", "Grand Canyon University-AZ"],
  ["liberty.edu", "VA", "Liberty University-VA"],
  ["umgc.edu", "MD", "Univ of Maryland Global Campus"],
  ["devry.edu", "IL", "DeVry University-IL"],
  // big publics — Southwest/West
  ["asu.edu", "AZ", "Arizona State University-Tempe"],
  ["arizona.edu", "AZ", "=University of Arizona"],
  ["nau.edu", "AZ", "Northern Arizona University"],
  ["unlv.edu", "NV", "Univ of Nevada/Las Vegas"],
  ["byu.edu", "UT", "Brigham Young University-UT"],
  ["utah.edu", "UT", "Univ of Utah"],
  ["usu.edu", "UT", "Utah State University"],
  ["uoregon.edu", "OR", "Univ of Oregon"],
  ["oregonstate.edu", "OR", "Oregon State University"],
  ["colorado.edu", "CO", "Univ of Colorado/Boulder"],
  ["colostate.edu", "CO", "Colorado State University"],
  ["unm.edu", "NM", "Univ of New Mexico/Albuquerque"],
  ["boisestate.edu", "ID", "Boise State University-ID"],
  ["hawaii.edu", "HI", "Univ of Hawaii/Manoa"],
  ["washington.edu", "WA", "=Univ of Washington"],
  ["wsu.edu", "WA", "Washington State University"],
  // California
  ["ucla.edu", "CA", "Univ of California/Los Angeles"],
  ["berkeley.edu", "CA", "Univ of California/Berkeley"],
  ["ucdavis.edu", "CA", "University of California Davis"],
  ["ucsd.edu", "CA", "Univ of California/San Diego"],
  ["uci.edu", "CA", "Univ of California/Irvine"],
  ["ucr.edu", "CA", "Univ of California/Riverside"],
  ["usc.edu", "CA", "Univ of Southern California"],
  ["sdsu.edu", "CA", "San Diego State University-CA"],
  ["csulb.edu", "CA", "Calif State Univ/Long Beach"],
  ["csun.edu", "CA", "Calif State Univ/Northridge"],
  ["fullerton.edu", "CA", "Calif State Univ/Fullerton"],
  ["sjsu.edu", "CA", "San Jose State University-CA"],
  ["calpoly.edu", "CA", "Calif Polytech State Univ/SLO"],
  ["cpp.edu", "CA", "Calif State Poly Univ/Pomona"],
  // Texas
  ["tamu.edu", "TX", "Texas A&M University/Coll Sta"],
  ["utexas.edu", "TX", "Univ of Texas/Austin"],
  ["uh.edu", "TX", "Univ of Houston/Univ Pk-TX"],
  ["txst.edu", "TX", "Texas State Univ San Marcos"],
  ["utsa.edu", "TX", "Univ of Texas/San Antonio"],
  ["uta.edu", "TX", "Univ of Texas/Arlington"],
  ["unt.edu", "TX", "Univ of North Texas"],
  ["ttu.edu", "TX", "Texas Tech University"],
  ["utep.edu", "TX", "Univ of Texas/El Paso"],
  // Midwest
  ["osu.edu", "OH", "Ohio State University"],
  ["kent.edu", "OH", "Kent State Univ Kent-OH"],
  ["ohio.edu", "OH", "Ohio University Athens-OH"],
  ["uc.edu", "OH", "Univ of Cincinnati-OH"],
  ["bgsu.edu", "OH", "Bowling Green State Univ-OH"],
  ["uakron.edu", "OH", "Univ of Akron-OH"],
  ["miamioh.edu", "OH", "Miami University-OH"],
  ["umich.edu", "MI", "Univ of Michigan Ann Arbor"],
  ["msu.edu", "MI", "Michigan State Univ"],
  ["wayne.edu", "MI", "Wayne State Uni Detroit-MI"],
  ["wmich.edu", "MI", "Western Michigan Univ/Kalamzoo"],
  ["cmich.edu", "MI", "Central Michigan University"],
  ["gvsu.edu", "MI", "Grand Valley State Univ-MI"],
  ["illinois.edu", "IL", "Univ of Illinois at Urb/Chmpn"],
  ["uic.edu", "IL", "Univ of Illinois at Chicago"],
  ["niu.edu", "IL", "Northern Illinois University"],
  ["cod.edu", "IL", "Coll of DuPage Glen Ellyn-IL"],
  ["wisc.edu", "WI", "Univ of Wisconsin Madison"],
  ["iastate.edu", "IA", "Iowa State University"],
  ["uiowa.edu", "IA", "Univ of Iowa"],
  ["unl.edu", "NE", "Univ of Nebraska/Lincoln"],
  // umn.edu: UMN Twin Cities is absent from Purdue's directory (Duluth/Morris/Crookston exist)
  ["mizzou.edu", "MO", "Univ of Missouri/Columbia"],
  ["ku.edu", "KS", "Univ of Kansas"],
  ["k-state.edu", "KS", "Kansas State University"],
  ["und.edu", "ND", "Univ Of North Dakota"],
  ["ndsu.edu", "ND", "North Dakota State Univ"],
  // South
  ["ufl.edu", "FL", "Univ of Florida"],
  ["ucf.edu", "FL", "Univ of Central Florida"],
  ["fiu.edu", "FL", "Florida Intl Univ/Miami"],
  ["usf.edu", "FL", "Univ of South Florida"],
  ["fsu.edu", "FL", "Florida State University"],
  ["fau.edu", "FL", "Florida Atlantic Univ/Boca Rtn"],
  ["uga.edu", "GA", "University of Georgia"],
  ["gsu.edu", "GA", "Georgia State University"],
  ["gatech.edu", "GA", "Georgia Inst of Technology"],
  ["kennesaw.edu", "GA", "Kennesaw State University-GA"],
  ["ua.edu", "AL", "University of Alabama"],
  ["auburn.edu", "AL", "Auburn University-AL"],
  ["utk.edu", "TN", "Univ of Tennessee Knoxville"],
  ["memphis.edu", "TN", "Univ of Memphis-TN"],
  ["mtsu.edu", "TN", "Middle Tennessee State Univ"],
  ["uky.edu", "KY", "Univ of Kentucky Lexington"],
  ["louisville.edu", "KY", "Univ of Louisville-KY"],
  ["wku.edu", "KY", "Western Kentucky University"],
  ["olemiss.edu", "MS", "Univ of Mississippi"],
  ["msstate.edu", "MS", "Mississippi State University"],
  ["lsu.edu", "LA", "Louisiana State Univ/A&M Coll"],
  ["uark.edu", "AR", "Univ of Arkansas/Fayetteville"],
  ["ou.edu", "OK", "Univ of Oklahoma"],
  ["okstate.edu", "OK", "Oklahoma State University"],
  ["ncsu.edu", "NC", "North Carolina State Univ"],
  ["ecu.edu", "NC", "East Carolina University-NC"],
  ["clemson.edu", "SC", "Clemson University-SC"],
  ["vt.edu", "VA", "Virginia Poly Inst & State Uni"],
  ["gmu.edu", "VA", "George Mason University-VA"],
  ["odu.edu", "VA", "Old Dominion University-VA"],
  ["vcu.edu", "VA", "Virginia Commonwealth Universi"],
  ["jmu.edu", "VA", "James Madison University-VA"],
  ["wvu.edu", "WV", "West Virginia Univ/Morgantown"],
  // Northeast
  ["psu.edu", "PA", "Pennsylvania State University"],
  ["temple.edu", "PA", "Temple University-PA"],
  ["pitt.edu", "PA", "University of Pittsburgh-PA"],
  ["drexel.edu", "PA", "Drexel University-PA"],
  ["rutgers.edu", "NJ", "Rutgers University-NJ"],
  ["umd.edu", "MD", "Univ of Maryland/College Park"],
  ["stonybrook.edu", "NY", "Stony Brook University-SUNY"],
  ["buffalo.edu", "NY", "University at Buffalo-SUNY"],
  ["nyu.edu", "NY", "New York University"],
  ["cornell.edu", "NY", "Cornell University-NY"],
  ["syracuse.edu", "NY", "Syracuse University-NY"],
  ["rit.edu", "NY", "Rochester Inst of Tech-NY"],
  ["uconn.edu", "CT", "Univ of Connecticut"],
  ["umass.edu", "MA", "Univ of Massachusetts/Amherst"],
  ["bu.edu", "MA", "Boston University-MA"],
  ["northeastern.edu", "MA", "Northeastern University-MA"],
];

const map = {};
const problems = [];
for (const [domain, state, pin] of PINS) {
  const exact = pin.startsWith("=");
  const needle = (exact ? pin.slice(1) : pin).toLowerCase();
  const hits = index.filter(
    (e) => e.l === "US" && e.s === state &&
      (exact ? e.n.toLowerCase() === needle : e.n.toLowerCase().includes(needle)),
  );
  if (hits.length !== 1) {
    problems.push(`${domain}: "${pin}" (${state}) -> ${hits.length} matches${hits.length ? ": " + hits.map((h) => h.n).join(" | ") : ""}`);
    continue;
  }
  const e = hits[0];
  map[domain] = { code: e.c, name: e.n, location: e.l, state: e.s };
}

writeFileSync("src/domain-map.json", JSON.stringify(map, null, 1));
console.log(`${Object.keys(map).length} domains mapped -> src/domain-map.json`);
if (problems.length) {
  console.log(`\n${problems.length} PROBLEMS (not mapped):\n  ` + problems.join("\n  "));
  process.exit(1);
}
