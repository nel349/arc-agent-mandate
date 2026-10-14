import { ARC_MAINNET, ARC_TESTNET, MONAD_TESTNET, type NetworkProfile } from "@kuiralabs/mandate-core";

/**
 * Each network's own logo, as its owner publishes it: the text of the files in `assets/networks/`,
 * which say where each comes from. Carried as text so `SvgXml` draws the file itself, on the phone and
 * in the browser alike, rather than a copy redrawn by hand, which both owners forbid.
 *
 * Arc testnet and Arc mainnet share Arc's icon, as wallets show a network's test chain with its logo;
 * the money each holds is said beside it, in words.
 */
export const ARC_LOGO = "<svg width=\"500\" height=\"500\" viewBox=\"0 0 500 500\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<rect width=\"500\" height=\"500\" rx=\"250\" fill=\"#1B3158\"/>\n<path d=\"M250.466 85C291.387 85 327.762 120.453 352.899 184.828C365.973 218.31 375.592 258.091 381.291 301.368C381.801 305.233 382.234 309.161 382.679 313.081C382.824 313.323 382.911 313.548 382.881 313.731C382.881 313.731 386.231 334.649 386.942 371.001H386.564C381.597 366.924 323.011 320.889 225.894 334.219C227.359 317.784 229.374 301.793 231.978 286.465C232.111 285.682 232.265 284.925 232.4 284.147C270.491 282.999 303.831 287.422 329.397 293.219C329.302 292.612 329.223 291.988 329.126 291.384C323.871 258.658 316.118 228.697 306.121 203.093C289.776 161.227 268.447 135.216 250.466 135.216C232.486 135.216 211.157 161.228 194.812 203.093C190.856 213.219 187.254 224.019 184.024 235.41C179.483 251.372 175.668 268.484 172.621 286.464C168.112 313.017 165.295 341.496 164.257 371.001H114C116.319 300.984 128.19 235.639 148.033 184.828C173.165 120.453 209.545 85.0002 250.466 85Z\" fill=\"white\"/>\n</svg>\n";

export const MONAD_LOGO = "<svg width=\"480\" height=\"480\" viewBox=\"0 0 480 480\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n<g clip-path=\"url(#clip0_1315_4002)\">\n<path d=\"M0 240C0 372.548 107.452 480 240 480C372.548 480 480 372.548 480 240C480 107.452 372.548 0 240 0C107.452 0 0 107.452 0 240Z\" fill=\"#6E54FF\"/>\n<g filter=\"url(#filter0_d_1315_4002)\">\n<path d=\"M240.135 90C196.78 90 90 196.68 90 240C90 283.318 196.78 390 240.135 390C283.491 390 390.273 283.316 390.273 240C390.273 196.682 283.493 90 240.135 90ZM216.739 325.774C198.457 320.796 149.302 234.89 154.285 216.624C159.268 198.357 245.251 149.248 263.533 154.226C281.817 159.204 330.971 245.108 325.989 263.376C321.005 281.642 235.023 330.752 216.739 325.774Z\" fill=\"white\"/>\n</g>\n</g>\n<defs>\n<filter id=\"filter0_d_1315_4002\" x=\"75\" y=\"90\" width=\"330.273\" height=\"330\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\">\n<feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\"/>\n<feColorMatrix in=\"SourceAlpha\" type=\"matrix\" values=\"0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0\" result=\"hardAlpha\"/>\n<feOffset dy=\"15\"/>\n<feGaussianBlur stdDeviation=\"7.5\"/>\n<feComposite in2=\"hardAlpha\" operator=\"out\"/>\n<feColorMatrix type=\"matrix\" values=\"0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.125 0\"/>\n<feBlend mode=\"normal\" in2=\"BackgroundImageFix\" result=\"effect1_dropShadow_1315_4002\"/>\n<feBlend mode=\"normal\" in=\"SourceGraphic\" in2=\"effect1_dropShadow_1315_4002\" result=\"shape\"/>\n</filter>\n<clipPath id=\"clip0_1315_4002\">\n<rect width=\"480\" height=\"480\" fill=\"white\"/>\n</clipPath>\n</defs>\n</svg>\n";

const LOGOS: ReadonlyMap<number, string> = new Map([
  [ARC_TESTNET.chainId, ARC_LOGO],
  [ARC_MAINNET.chainId, ARC_LOGO],
  [MONAD_TESTNET.chainId, MONAD_LOGO],
]);

/** A network's logo, or null for one this build has none for, which is then drawn as its colour. */
export const logoOf = (network: NetworkProfile): string | null => LOGOS.get(network.chainId) ?? null;
