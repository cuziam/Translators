require("dotenv").config(); //.env파일을 읽어서 process.env에 넣어줌

const axios = require("axios");
const { EventEmitter } = require("events");
const translationEvents = new EventEmitter();
const { languageToISOCode, ISOCodeToLanguage } = require("./util");

function sendEvents(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const onTranslationUpdate = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  translationEvents.on("update", onTranslationUpdate);
  res.on("close", () => {
    translationEvents.removeListener("update", onTranslationUpdate);
  });
}

//post요청이 /으로 들어오면 papago api로 데이터들을 보내고 응답을 받은 후에 응답내용을 클라이언트에게 보내준다.
const translatePapago = async function (srcText, srcLang, targetLang) {
  console.log(srcText, srcLang, targetLang);
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  const apiUrl = "https://openapi.naver.com/v1/papago/n2mt";
  const options = {
    method: "POST",
    url: apiUrl,
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
    data: `source=${srcLang}&target=${targetLang}&text=${encodeURIComponent(
      srcText
    )}`,
  };
  try {
    const response = await axios(options);
    console.log(response.data.message.result.translatedText);
    translationEvents.emit("update", [
      {
        srcLang: ISOCodeToLanguage(srcLang),
        targetLang: ISOCodeToLanguage(targetLang),
        targetText: response.data.message.result.translatedText,
        targetTool: "Papago",
      },
    ]);
  } catch (error) {
    console.log(error);
  }
};

const { TranslationServiceClient } = require("@google-cloud/translate");
const translationClient = new TranslationServiceClient();

const projectId = process.env.GOOGLE_PROJECT_ID;
const location = process.env.GOOGLE_LOCATION;
const translateGoogle = async function (srcText, srcLang, targetLang) {
  console.log(srcText, srcLang, targetLang);
  const request = {
    parent: `projects/${projectId}/locations/${location}`,
    contents: [srcText],
    mimeType: "text/plain", // mime types: text/plain, text/html
    sourceLanguageCode: srcLang,
    targetLanguageCode: targetLang,
  };
  try {
    const [response] = await translationClient.translateText(request);
    console.log(response.translations[0].translatedText);
    translationEvents.emit("update", [
      {
        srcLang: ISOCodeToLanguage(srcLang),
        targetLang: ISOCodeToLanguage(targetLang),
        targetText: response.translations[0].translatedText,
        targetTool: "Google Translator",
      },
    ]);
  } catch (error) {
    console.log(error);
  }
};

const deepl = require("deepl-node");
const authKey = process.env.DEEPL_AUTH_KEY;
const translator = new deepl.Translator(authKey);
const translateDeepl = async function (srcText, srcLang, targetLang) {
  console.log(srcText, srcLang, targetLang);
  try {
    const response = await translator.translateText(
      srcText,
      srcLang,
      targetLang
    );
    console.log(response.text);
    translationEvents.emit("update", [
      {
        srcLang: ISOCodeToLanguage(srcLang),
        targetLang: ISOCodeToLanguage(targetLang),
        targetText: response.text,
        targetTool: "DeepL",
      },
    ]);
  } catch (error) {
    console.log(error);
  }
};

function translateClientReq(reqBody) {
  reqBody.forEach((config) => {
    let { srcLang, srcText, targetLang, targetTool } = config;
    //normalize each string
    srcLang = languageToISOCode(srcLang);
    targetLang = languageToISOCode(targetLang);

    //call the appropriate translation function
    if (targetTool === "Papago") {
      translatePapago(srcText, srcLang, targetLang);
    } else if (targetTool === "Google Translator") {
      translateGoogle(srcText, srcLang, targetLang);
    } else if (targetTool === "DeepL") {
      translateDeepl(srcText, srcLang, targetLang);
    }
  });
}

module.exports = {
  translatePapago,
  translateGoogle,
  translateDeepl,
  translateClientReq,
  sendEvents,
};
