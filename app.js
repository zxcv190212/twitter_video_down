const express = require('express');
const { exec } = require('child_process');
const path = require('path');

const app = express();
const port = 3000;

// EJS 템플릿 엔진 설정
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 정적 파일 서비스 설정 (CSS 등)
app.use(express.static(path.join(__dirname, 'public')));

// URL 인코딩된 본문 파싱 설정 (폼 데이터 처리를 위함)
app.use(express.urlencoded({ extended: true }));

/**
 * 트위터 게시물 URL에서 모든 영상의 최고 화질/음질 직접 다운로드 링크와 썸네일 링크를 추출합니다.
 *
 * @param {string} tweetUrl 트위터 게시물 URL
 * @returns {Promise<Array<{video_link: string|null, thumbnail_link: string|null}>>}
 */
async function getAllVideoLinksAndThumbnails(tweetUrl) {
    console.log(`--- 트위터 게시물 내 모든 영상 및 썸네일 링크 추출 시도: ${tweetUrl} ---`);

    return new Promise((resolve, reject) => {
        process.env.YTDLP_NO_WARNINGS = '1';

        // 저장 방지 옵션 (--skip-download) 포함
        const skipDownloadOption = '--skip-download';
        let command;
        if (process.platform === 'win32') {
            command = `yt-dlp ${skipDownloadOption} --print-json --format "best[ext=mp4]/best" --force-ipv4 --quiet --no-warnings "${tweetUrl}" 2>NUL`;
        } else {
            command = `yt-dlp ${skipDownloadOption} --print-json --format "best[ext=mp4]/best" --force-ipv4 --quiet --no-warnings "${tweetUrl}" 2>/dev/null`;
        }

        exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) {
                console.error(`명령어 실행 오류: ${error.message}`);
                console.error(`stderr: ${stderr}`);
                return reject(new Error(`영상을 가져오는 데 실패했습니다. (${error.message})`));
            }

            try {
                const allVideoData = [];

                const jsonLines = stdout
                    .split('\n')
                    .filter(line => line.trim().startsWith('{') && line.trim().endsWith('}'));

                for (const jsonString of jsonLines) {
                    let targetInfo;
                    try {
                        targetInfo = JSON.parse(jsonString);
                    } catch (err) {
                        console.error(`개별 JSON 파싱 실패: ${err.message}`);
                        continue;
                    }

                    let videoDirectUrl = null;
                    let thumbnail_url = null;

                    if (targetInfo.url) {
                        videoDirectUrl = targetInfo.url;
                    } else if (targetInfo.formats && Array.isArray(targetInfo.formats)) {
                        let bestFormat = null;
                        for (const format of targetInfo.formats) {
                            if (
                                format.format_id === 'best' ||
                                (format.preference !== undefined &&
                                    (bestFormat === null || format.preference > bestFormat.preference))
                            ) {
                                bestFormat = format;
                            }
                        }
                        if (bestFormat && bestFormat.url) {
                            videoDirectUrl = bestFormat.url;
                        }
                    }

                    if (targetInfo.thumbnail) {
                        thumbnail_url = targetInfo.thumbnail;
                    } else if (
                        targetInfo.thumbnails &&
                        Array.isArray(targetInfo.thumbnails) &&
                        targetInfo.thumbnails.length > 0
                    ) {
                        const bestThumbnail = targetInfo.thumbnails.sort((a, b) => {
                            const sizeA = (a.width || 0) * (a.height || 0);
                            const sizeB = (b.width || 0) * (b.height || 0);
                            return sizeB - sizeA;
                        })[0];
                        if (bestThumbnail && bestThumbnail.url) {
                            thumbnail_url = bestThumbnail.url;
                        }
                    }

                    if (videoDirectUrl || thumbnail_url) {
                        allVideoData.push({
                            video_link: videoDirectUrl,
                            thumbnail_link: thumbnail_url,
                        });
                    }
                }

                resolve(allVideoData);
            } catch (parseError) {
                console.error(`JSON 파싱 오류: ${parseError.message}`);
                console.error(`stdout 예시: ${stdout.substring(0, 1000)}...`);
                reject(new Error(`yt-dlp 결과 파싱에 실패했습니다. (${parseError.message})`));
            }
        });
    });
}

// --- 라우트 설정 ---

app.get('/', (req, res) => {
    res.render('index', { videoData: null, error: null, submittedUrl: '' });
});

app.post('/download', async (req, res) => {
    const tweetUrl = req.body.tweetUrl;

    if (!tweetUrl) {
        return res.render('index', {
            videoData: null,
            error: '트위터 URL을 입력해주세요.',
            submittedUrl: ''
        });
    }

    try {
        const allVideoData = await getAllVideoLinksAndThumbnails(tweetUrl);
        res.render('index', {
            videoData: allVideoData,
            error: null,
            submittedUrl: tweetUrl
        });
    } catch (err) {
        console.error("Express 라우트 핸들러 오류:", err.message);
        res.render('index', {
            videoData: null,
            error: err.message,
            submittedUrl: tweetUrl
        });
    }
});

// 서버 시작
app.listen(port, () => {
    console.log(`서버가 http://localhost:${port} 에서 실행 중입니다.`);
    console.log("Ctrl+C를 눌러 서버를 종료하세요.");
});
