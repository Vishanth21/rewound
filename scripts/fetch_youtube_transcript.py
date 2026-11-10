import json
import sys


def main():
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        print("Install the caption fetcher with: python -m pip install -r requirements.txt", file=sys.stderr)
        return 2

    video_id = sys.argv[1]
    try:
        transcript = YouTubeTranscriptApi().fetch(video_id, languages=["en"])
        print(json.dumps({
            "language": transcript.language,
            "languageCode": transcript.language_code,
            "isGenerated": transcript.is_generated,
            "snippets": [
                {"text": cue.text, "start": cue.start, "duration": cue.duration}
                for cue in transcript
            ],
        }, ensure_ascii=False))
        return 0
    except Exception as error:
        print(f"Could not fetch English captions: {type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
