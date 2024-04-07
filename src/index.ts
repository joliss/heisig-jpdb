import { readFileSync, writeFileSync } from "fs";
import Papa from "papaparse";
import axios from "axios";
import * as cheerio from "cheerio";
import memoizeFs from "../node_modules/memoize-fs/dist/index.js";

let csvInputString = readFileSync(
  "vendor/heisig-kanjis/heisig-kanjis.csv",
  "utf8"
);

const memoizer = memoizeFs({ cachePath: "./.cache" });

interface HeisigKanji {
  kanji: string;
  id_5th_ed: string;
  id_6th_ed: string;
  keyword_5th_ed: string;
  keyword_6th_ed: string;
  components: string;
  on_reading: string;
  kun_reading: string;
  stroke_count: string;
  jlpt: string;
}

type Edition = "5" | "6";

interface KanjiInfo {
  kanji: string;
  heisigId: Record<Edition, number | null>;
  heisigKeyword: Record<Edition, string>;
  jpdbKeyword: string;
}

let heisigKanjis = Papa.parse(csvInputString, {
  header: true,
  skipEmptyLines: true,
}).data as HeisigKanji[];

let sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getUrl(url: string): Promise<string> {
  console.error(`Fetching ${url}`);
  let response = await axios.get(url);
  // The server blocks us if we go faster
  await sleep(1000);
  return response.data;
}

async function extractKeywordForKanji(kanji: string): Promise<string> {
  let url = `https://jpdb.io/kanji/${kanji}`;
  // Fetch the HTML content of the page
  let getUrlCached = await memoizer.fn(getUrl, {
    cacheId: "getUrl",
    noBody: true,
  });
  let responseData = await getUrlCached(url);
  let $ = cheerio.load(responseData);
  let keyword: string = $('.subsection-label:contains("Keyword") + .subsection')
    .text()
    .trim();
  return keyword;
}

function maybeParseInt(value: string): number | null {
  return value !== "" ? parseInt(value) : null;
}

async function getKanjiInfos(): Promise<KanjiInfo[]> {
  let kanjiInfos: KanjiInfo[] = [];
  for (let heisigKanji of heisigKanjis) {
    kanjiInfos.push({
      kanji: heisigKanji.kanji,
      heisigId: {
        "5": maybeParseInt(heisigKanji.id_5th_ed),
        "6": maybeParseInt(heisigKanji.id_6th_ed),
      },
      heisigKeyword: {
        "5": heisigKanji.keyword_5th_ed,
        "6": heisigKanji.keyword_6th_ed,
      },
      jpdbKeyword: await extractKeywordForKanji(heisigKanji.kanji),
    });
  }
  return kanjiInfos;
}

interface CSVRow {
  kanji: string;
  heisigId: string;
  heisigKeyword: string;
  jpdbKeyword: string;
}

function getHtml(kanjiInfos: KanjiInfo[], edition: Edition): string {
  // Please excuse the unsafe string interpolation
  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Kanji Keywords</title>
        <style>
          table {
            border-collapse: collapse;
          }
          th, td {
            border: 1px solid black;
            padding: 0.5em;
          }
          .is-different {
            background-color: #eee;
          }
        </style>
      </head>
      <body>
        <h1>Kanji Keywords (Heisig ${edition}th Edition)</h1>
        <table>
          <thead>
            <tr>
              <th>Heisig ID</th>
              <th>Kanji</th>
              <th>Heisig Keyword</th>
              <th>JPDB Keyword</th>
            </tr>
          </thead>
          <tbody>
            ${kanjiInfos
              .map((kanjiInfo) => {
                let isDifferent =
                  kanjiInfo.heisigKeyword[edition] !== kanjiInfo.jpdbKeyword;
                return `
                  <tr class="${isDifferent ? "is-different" : ""}">
                    <td>${kanjiInfo.heisigId[edition]}</td>
                    <td>${kanjiInfo.kanji}</td>
                    <td>
                      <a href="https://kanji.koohii.com/study/kanji/${
                        kanjiInfo.kanji
                      }">
                        ${kanjiInfo.heisigKeyword[edition]}
                      </a>
                    </td>
                    <td>
                      <a href="https://jpdb.io/kanji/${kanjiInfo.kanji}">
                        ${kanjiInfo.jpdbKeyword}
                      </a>
                    </td>
                  </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </body>
    </html>
  `;
}

async function main() {
  let kanjiInfos = await getKanjiInfos();
  for (let edition of ["5", "6"] as Edition[]) {
    let outFileBase = `docs/kanji-keywords-${edition}th-edition`;
    let kanjiInfosForEdition = kanjiInfos
      .filter((kanjiInfo) => kanjiInfo.heisigId[edition] != null)
      .toSorted((a, b) => a.heisigId[edition]! - b.heisigId[edition]!);

    let csvRows: CSVRow[] = kanjiInfosForEdition.map((kanjiInfo) => ({
      kanji: kanjiInfo.kanji,
      heisigId: kanjiInfo.heisigId[edition]!.toString(),
      heisigKeyword: kanjiInfo.heisigKeyword[edition],
      jpdbKeyword: kanjiInfo.jpdbKeyword,
    }));
    let csvOutputString = Papa.unparse(csvRows);
    writeFileSync(`${outFileBase}.csv`, csvOutputString);
    writeFileSync(
      `${outFileBase}.html`,
      getHtml(kanjiInfosForEdition, edition)
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
