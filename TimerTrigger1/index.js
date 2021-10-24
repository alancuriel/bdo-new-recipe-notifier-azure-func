module.exports = async function (context, myTimer) {
  if (process.env.NODE_ENV !== "production") {
    require("dotenv").config();
  }

  const cheerio = require("cheerio");
  const sgMail = require("@sendgrid/mail");
  const fetch = (...args) =>
    import("node-fetch").then(({ default: fetch }) => fetch(...args));
  context.log(cheerio);

  function sendEmail(msg, content, filename) {
    const str = Buffer.from(content).toString("base64");
    return sgMail.send({
      to: "alanecuriel@gmail.com", // Change to your recipient
      from: "alan@alancuriel.com", // Change to your verified sender
      subject: "Recipe Alert",
      text: msg,
      attachments: [
        {
          content: str,
          filename: `${filename}.json`,
          type: "application/json",
          disposition: "attachment",
        },
      ],
    });
  }

  async function createRecipe(data) {
    return {
      id: createId(data),
      name: createName(data),
      icon: createIcon(data),
      grade: createGrade(data),
      process: data[3],
      mastery: createMastery(data),
      exp: parseNumber(data[5]),
      materials: await createItems(data, 6),
      products: await createItems(data, 7),
    };
  }

  function createName(data) {
    const $ = cheerio.load(data[2]);
    const bold = $("b");
    if ($(bold).text()) return $(bold).text();
    return $("a").text();
  }

  function createId(data) {
    return typeof data[0] === "object" ? data[0].display.toString() : data[0];
  }

  function createIcon(data) {
    const text = cheerio.load(data[1])("div").first().text();
    return substrOf(text, { left: 'src="', right: '"' });
  }

  function createGrade(data) {
    const text = substrOf(data[2], { left: "item_grade_", right: " " });
    return parseNumber(text);
  }

  function createMastery(data) {
    const text = data[4].display;
    if (!text) return;
    const args = text?.split(" ");
    const level = parseNumber(args.pop());
    const name = args.join(" ");
    return { name, level };
  }

  async function createItems(data, index) {
    const $ = cheerio.load("<div>" + data[index || 0] + "</div>");

    const output = [];

    const array = $(".iconset_wrapper_medium").toArray();

    for (let index = 0; index < array.length; index++) {
      const elem = array[index];

      const url = $(elem).find("a").attr("href");
      if (!url) return;
      const { type, id } = decompose(url);

      const { grade, name } = await scrapeItem(type, id);

      output.push({
        id,
        name,
        grade,
        type,
        icon: substrOf($(elem).find(".icon_wrapper").text(), {
          left: 'src="',
          right: '"',
        }),
        amount: parseNumber($(elem).find(".quantity_small").text(), 1),
      });
    }

    return output;
  }

  const decompose = (url) => {
    const [locale, type, ...idArgs] = url.split("/").filter((e) => e);
    return {
      locale,
      type,
      id: idArgs.join("/"),
    };
  };

  const parseNumber = (num, defaultNum = 0) => {
    const parsedValue = parseFloat(num.replace(/[^0-9.]/g, ""));
    if (isNaN(parsedValue)) {
      return defaultNum;
    } else {
      return parsedValue;
    }
  };

  const substrOf = (str, boundaries) => {
    const startIdx = !!boundaries.left
      ? str.indexOf(boundaries.left) + boundaries.left.length
      : 0;
    const endIdx = !!boundaries.right
      ? str.indexOf(boundaries.right, startIdx)
      : str.length;
    if (startIdx !== 0 || endIdx !== str.length)
      return str.substring(startIdx, endIdx);
    return str;
  };

  async function scrapeItem(type, id) {
    const url = `${BASE_URL}/tip.php?id=${type}--${id}&caphrasenhancement=&l=us&nf=on`;
    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);
    const name = $("b").first().text();
    const gradeStr = substrOf(html, { left: "item_grade_", right: " " });
    return { name, grade: parseNumber(gradeStr) };
  }

  const BASE_URL = "https://bdocodex.com";
  // const BASE_URL = "https://bddatabase.net";

  const COOKING_URL = BASE_URL + "/query.php?a=recipes&type=culinary&id=1&l=us";
  const ALCHEMY_URL = BASE_URL + "/query.php?a=recipes&type=alchemy&id=1&l=us";

  const GH_COOKING_URL =
    "https://raw.githubusercontent.com/alancuriel/bdo-recipes/main/cooking.json";
  const GH_ALCHEMY_URL =
    "https://raw.githubusercontent.com/alancuriel/bdo-recipes/main/alchemy.json";

  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

  await Promise.all([
    fetch(GH_COOKING_URL).then((data) => data.json()),
    fetch(COOKING_URL)
      .then((data) => data.text())
      .then((text) => JSON.parse(text.trim()))
      .then((jsonData) =>
        Promise.all(
          jsonData.aaData.map((recipeData) => createRecipe(recipeData))
        )
      ),
  ])
    .then(([ghCookingRecipes, cookingRecipes]) => {
      const ids = new Set(ghCookingRecipes.map((recipe) => recipe.id));

      let newRecipes = false;

      for (const recipe of cookingRecipes) {
        if (!ids.has(recipe.id)) {
          newRecipes = true;
          break;
        }
      }

      return newRecipes
        ? sendEmail(
            "Updated Cooking Recipes",
            JSON.stringify(cookingRecipes),
            "cooking"
          )
        : Promise.reject("no cooking recipes");
    })
    .then(() => context.log("email sent"))
    .catch((err) => context.log(err));

  await Promise.all([
    fetch(GH_ALCHEMY_URL).then((data) => data.json()),
    fetch(ALCHEMY_URL)
      .then((data) => data.text())
      .then((text) => JSON.parse(text.trim()))
      .then((jsonData) =>
        Promise.all(
          jsonData.aaData.map((recipeData) => createRecipe(recipeData))
        )
      ),
  ])
    .then(([ghAlchemyRecipes, alchemyRecipes]) => {
      const ids = new Set(ghAlchemyRecipes.map((recipe) => recipe.id));

      let newRecipes = false;

      for (const recipe of alchemyRecipes) {
        if (!ids.has(recipe.id)) {
          newRecipes = true;
          break;
        }
      }

      return newRecipes
        ? sendEmail(
            "Updated Alchemy Recipes",
            JSON.stringify(alchemyRecipes),
            "alchemy"
          )
        : Promise.reject("no alchemy recipes");
    })
    .then(() => context.log("email sent"))
    .catch((err) => context.log(err));
};
