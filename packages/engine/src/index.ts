export type { Unit, FmtOptions, UnitScheme, UnitSystem } from "./units";
export {
  convert,
  DEFAULT_UNIT_SYSTEM,
  fmt,
  fmtTex,
  ftToIn,
  ftToM,
  in2ToMm2,
  in3ToMm3,
  in4ToMm4,
  inToFt,
  inToMm,
  kipFtToKipIn,
  kipFtToKnM,
  kipInToKipFt,
  kipToKn,
  knMToKipFt,
  knToKip,
  ksiToMPa,
  ksiToPsi,
  mm2ToIn2,
  mm3ToIn3,
  mm4ToIn4,
  mmToIn,
  mPaToKsi,
  mToFt,
  psiToKsi,
  sqrtFcMPa,
  sqrtFcPsi,
  unitScheme,
} from "./units";

export type {
  CheckResult,
  CheckResultArgs,
  CheckStatus,
  CodeRef,
  DeriveArgs,
  Traced,
} from "./trace";
export {
  aci,
  checkResult,
  constant,
  derive,
  flattenTrace,
  input,
  stampEdition,
  traceToMarkdown,
  validateTrace,
} from "./trace";

export type { Bar, BarSize, Concrete, RebarGrade } from "./materials";
export {
  BARS,
  bar,
  beta1,
  concrete,
  concreteMPa,
  Ec,
  fcInput,
  GRADE60,
  GRADE80,
  GRADE420,
  GRADE550,
  lambdaInput,
} from "./materials";

export type {
  BarStation,
  Demands,
  DistributedLayer,
  EndZoneBars,
  SbeProvided,
  SeismicParams,
  WallGeometry,
  WallInput,
} from "./wall";

export {
  checkCurtains,
  checkMinThickness,
  checkSpacing,
  checkTies,
} from "./checks/detailing";
export { checkMinReinforcement, PHI_SHEAR, rhoProvidedNode } from "./checks/min-reinforcement";
export { alphaC, checkInPlaneShear } from "./checks/shear-in-plane";
export {
  checkOutOfPlaneShear,
  checkSimplifiedAxial,
  effectiveDepthOutOfPlane,
} from "./checks/out-of-plane";
export { checkFlexureAxial } from "./checks/flexure-axial";
export type { DemandChecks, WallReport } from "./checks/report";
export { worstStatus } from "./checks/report";
export type { OrdinaryWallReport } from "./checks/ordinary-wall";
export { checkOrdinaryWall } from "./checks/ordinary-wall";

// --- special structural walls (18.10) --------------------------------------
export { checkSeismicWebReinforcement, sqrtFcNode } from "./checks/special-reinforcement";
export type { AmplifiedShear } from "./checks/special-shear";
export { amplifiedShear, checkSpecialShear } from "./checks/special-shear";
export type { DriftCapacityArgs, SbeRequirement } from "./checks/boundary-element";
export {
  checkSbeDetailing,
  checkSbeRequired,
  driftCapacityRatio,
  sbeRequirement,
  sigmaExtreme,
} from "./checks/boundary-element";
export type { SpecialWallReport } from "./checks/special-wall";
export { checkSpecialWall } from "./checks/special-wall";
export type {
  AxialLimits,
  CurveOptions,
  DesignPoint,
  DesignSlice,
  SectionPoint,
} from "./section/interaction";
export {
  axialLimits,
  cAt,
  designCurve,
  designSliceAt,
  interactionCurve,
  mprAt,
  phiMnAt,
  sectionAt,
} from "./section/interaction";
export {
  Acv,
  Ag,
  barPositions,
  hInput,
  huInput,
  huValue,
  hwInput,
  hwcsInput,
  hwcsOverLw,
  hwcsValue,
  hwOverLw,
  lwInput,
  schemeOf,
  totalVerticalAs,
  unitsOf,
} from "./wall";
