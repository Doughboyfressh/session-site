import Link from 'next/link';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Headphones,
  Mic2,
  Music2,
  Users,
  Waves,
} from 'lucide-react';
import { demos, genres } from '@/lib/catalog';
import './landing.css';

const featured = ['BRICKLIGHT', 'AFTER HOURS', 'LOGWOOD'].flatMap((title) => {
  const track = demos.find((candidate) => candidate.title === title);
  return track ? [track] : [];
});
const wave = [
  12, 25, 18, 42, 65, 30, 48, 78, 40, 23, 62, 88, 46, 30, 65, 40, 20, 50, 74,
  44, 26, 57, 34, 80, 58, 30, 48, 21, 62, 42, 18, 35,
];

function VinylScene() {
  return (
    <figure
      className="landing-vinyl-scene"
      aria-label="An illustrated SESSION record surrounded by sound waves"
    >
      <div className="landing-orbit orbit-one" />
      <div className="landing-orbit orbit-two" />
      <div className="landing-sound-stripe" />
      <span className="landing-scene-coordinate coordinate-top">
        SIDE A / YOUR NEXT IDEA
      </span>
      <div className="landing-record">
        <div className="landing-record-grooves" />
        <div className="landing-record-label">
          <AudioLines size={30} strokeWidth={1.4} />
          <strong>session.</strong>
          <span>
            INDEPENDENT SOUNDS
            <br />
            SHARED SPACE
          </span>
          <i />
        </div>
      </div>
      <div className="landing-wave-strip" aria-hidden="true">
        {wave.map((height, index) => (
          <i key={index} style={{ height: `${height}%` }} />
        ))}
      </div>
      <div className="landing-scene-note">
        <span className="landing-note-line" />
        <span>
          A LITTLE SPARK.
          <br />
          <strong>A WHOLE NEW SOUND.</strong>
        </span>
      </div>
      <span className="landing-scene-coordinate coordinate-bottom">
        PLAY. CREATE. CONNECT.
      </span>
    </figure>
  );
}

function StudioSketch() {
  const layers = [
    { name: 'Drums', color: 'red', widths: [26, 26, 26], offset: 0 },
    { name: 'Bass', color: 'gray', widths: [34, 34], offset: 12 },
    { name: 'Keys', color: 'light', widths: [24, 24, 24], offset: 6 },
    { name: 'Your voice', color: 'pink', widths: [48], offset: 32 },
  ];
  return (
    <figure className="landing-studio-sketch">
      <figcaption>
        <span>
          <AudioLines size={17} /> A glimpse of the studio
        </span>
        <span>92 BPM · 4/4</span>
      </figcaption>
      <div className="landing-sketch-ruler" aria-hidden="true">
        <span />
        <span>01</span>
        <span>05</span>
        <span>09</span>
        <span>13</span>
      </div>
      <div className="landing-sketch-layers" aria-hidden="true">
        {layers.map((layer) => (
          <div className="landing-sketch-layer" key={layer.name}>
            <span>{layer.name}</span>
            <div
              className="landing-sketch-lane"
              style={{ paddingLeft: `${layer.offset}%` }}
            >
              {layer.widths.map((width, index) => (
                <div
                  className={`landing-sketch-clip clip-${layer.color}`}
                  key={index}
                  style={{ width: `${width}%` }}
                >
                  <svg
                    viewBox="0 0 100 32"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    {wave
                      .filter((_, i) => i % 2 === 0)
                      .map((height, i) => (
                        <rect
                          key={i}
                          x={i * 6 + 3}
                          y={16 - height * 0.13}
                          width="2"
                          height={height * 0.26}
                          rx="1"
                        />
                      ))}
                  </svg>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="landing-sketch-playhead" />
      </div>
      <div className="landing-sketch-footer">
        <span>
          <span className="landing-sketch-dot" /> YOUR IDEA, IN THE MIX
        </span>
        <span>RECORD · ARRANGE · EXPORT</span>
      </div>
    </figure>
  );
}

export default function LandingPage() {
  return (
    <div className="session-landing">
      <Link prefetch={false} className="landing-skip" href="#landing-main">
        Skip to content
      </Link>
      <header className="landing-header">
        <Link
          prefetch={false}
          className="landing-logo"
          href="/"
          aria-label="SESSION home"
        >
          session<span>.</span>
        </Link>
        <nav className="landing-section-nav" aria-label="About SESSION">
          <Link prefetch={false} href="#sounds">
            The sounds
          </Link>
          <Link prefetch={false} href="#studio">
            The studio
          </Link>
          <Link prefetch={false} href="#together">
            The people
          </Link>
        </nav>
        <div className="landing-header-actions">
          <Link
            prefetch={false}
            className="landing-signin"
            href="/signin-with-chatgpt?return_to=%2Fapp"
          >
            Sign in
          </Link>
          <Link prefetch={false} className="landing-nav-enter" href="/app">
            Open SESSION <ArrowUpRight size={15} />
          </Link>
        </div>
      </header>

      <main id="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow">
              <span /> FOR THE ONES WHO MAKE MUSIC
            </p>
            <h1 id="landing-title">
              Your sound.
              <br />
              Your people.
              <br />
              <em>Your session.</em>
            </h1>
            <p className="landing-hero-description">
              Find a beat, record the moment, and bring your people in. Your
              next track starts right here, in your browser.
            </p>
            <div className="landing-actions">
              <Link
                prefetch={false}
                className="landing-button landing-button-red"
                href="/app?view=Studio"
              >
                Start creating <ArrowRight size={18} />
              </Link>
              <Link
                prefetch={false}
                className="landing-button landing-button-outline"
                href="/app?view=Beat%20library"
              >
                Explore the beats <Headphones size={18} />
              </Link>
            </div>
            <p className="landing-hero-note">
              No download needed. Just an idea and a little curiosity.
            </p>
          </div>
          <VinylScene />
          <Link prefetch={false} className="landing-scroll" href="#sounds">
            <ArrowDown size={14} /> A SPACE FOR YOUR NEXT SOUND
          </Link>
        </section>

        <div
          className="landing-proof-strip"
          aria-label="What you can make with SESSION"
        >
          <span>
            <strong>{demos.length}</strong> original beats
          </span>
          <span>
            <strong>{genres.length - 1}</strong> genre families
          </span>
          <span>
            <Waves size={19} /> A studio in your browser
          </span>
          <span>
            <Users size={19} /> Create together
          </span>
        </div>

        <section
          className="landing-sounds landing-section"
          id="sounds"
          aria-labelledby="landing-sounds-title"
        >
          <div className="landing-section-heading">
            <div>
              <p className="landing-eyebrow">01 / FIND YOUR FREQUENCY</p>
              <h2 id="landing-sounds-title">
                Every great track
                <br />
                starts somewhere.
              </h2>
            </div>
            <div className="landing-section-aside">
              <p>
                Hip-hop to house. Soul to country. Explore SESSION Originals and
                find the spark for something that’s yours.
              </p>
              <Link
                prefetch={false}
                className="landing-text-link"
                href="/app?view=Beat%20library"
              >
                Find your beat <ArrowUpRight size={17} />
              </Link>
            </div>
          </div>
          <div className="landing-beat-grid">
            {featured.map((track, index) => (
              <Link
                prefetch={false}
                className={`landing-beat beat-style-${index}`}
                key={track.id}
                href={`/t/${encodeURIComponent(track.id)}`}
                aria-label={`Listen to ${track.title}, ${track.genre}, ${track.bpm} BPM`}
              >
                <div className="landing-beat-art" aria-hidden="true">
                  <span className="landing-beat-genre">{track.genre}</span>
                  <div className="landing-mini-record">
                    <div />
                    <span>
                      SESSION
                      <br />
                      ORIGINALS
                    </span>
                  </div>
                  <span className="landing-beat-art-title">{track.title}</span>
                  <span className="landing-beat-arrow">
                    <ArrowUpRight size={22} />
                  </span>
                </div>
                <div className="landing-beat-title">
                  <h3>{track.title}</h3>
                  <span>{track.bpm} BPM</span>
                </div>
                <p>
                  {track.creator} <span>{track.musicalKey}</span>
                </p>
              </Link>
            ))}
          </div>
          <p className="landing-genre-line">
            Hip-hop <span>·</span> R&B <span>·</span> Amapiano <span>·</span>{' '}
            Electronic <span>·</span> Jazz <span>·</span> Rock <span>·</span>{' '}
            Country <span>·</span> Gospel <span>·</span> and more
          </p>
        </section>

        <section
          className="landing-studio landing-section"
          id="studio"
          aria-labelledby="landing-studio-title"
        >
          <div className="landing-studio-copy">
            <p className="landing-eyebrow">02 / MAKE IT YOURS</p>
            <h2 id="landing-studio-title">
              Less setup.
              <br />
              More making.
            </h2>
            <p>
              A beat becomes a backing track. A voice memo becomes a verse.
              Bring it all into a studio that goes wherever you do.
            </p>
            <ul className="landing-feature-list">
              <li>
                <Mic2 size={19} />
                <span>Record your voice and instruments</span>
              </li>
              <li>
                <Music2 size={19} />
                <span>Shape separate notes, drums, and audio layers</span>
              </li>
              <li>
                <AudioLines size={19} />
                <span>Arrange, mix, and export your track as WAV</span>
              </li>
            </ul>
            <Link
              prefetch={false}
              className="landing-text-link"
              href="/app?view=Studio"
            >
              Step into the studio <ArrowUpRight size={17} />
            </Link>
          </div>
          <StudioSketch />
        </section>

        <section
          className="landing-together landing-section"
          id="together"
          aria-labelledby="landing-together-title"
        >
          <figure
            className="landing-together-art"
            aria-label="An illustrated private room connecting an artist, producer, and engineer"
          >
            <div className="landing-connection connection-one" />
            <div className="landing-connection connection-two" />
            <div className="landing-connection connection-three" />
            <div className="landing-room-core">
              <AudioLines size={44} strokeWidth={1.2} />
              <span>YOUR SESSION</span>
            </div>
            <div className="landing-person person-artist">
              <span>01</span>
              <Mic2 size={27} />
              <strong>THE ARTIST</strong>
            </div>
            <div className="landing-person person-producer">
              <span>02</span>
              <Music2 size={27} />
              <strong>THE PRODUCER</strong>
            </div>
            <div className="landing-person person-engineer">
              <span>03</span>
              <Headphones size={27} />
              <strong>THE ENGINEER</strong>
            </div>
            <span className="landing-room-caption">
              DIFFERENT TALENTS. SAME WAVELENGTH.
            </span>
          </figure>
          <div className="landing-together-copy">
            <p className="landing-eyebrow">03 / BRING YOUR PEOPLE</p>
            <h2 id="landing-together-title">
              Good music
              <br />
              has good company.
            </h2>
            <p>
              Find the artist, producer, engineer, or videographer who gets your
              sound. Invite them into a private room and build on the same idea.
            </p>
            <p>
              Share studio audio, talk it through, and work on a shared project.
              Send an invitation inside SESSION or share a room link.
            </p>
            <Link
              prefetch={false}
              className="landing-text-link"
              href="/app?view=Studio%20rooms"
            >
              Make room for your people <ArrowUpRight size={17} />
            </Link>
          </div>
        </section>

        <section
          className="landing-faq landing-section"
          aria-labelledby="landing-faq-title"
        >
          <div>
            <p className="landing-eyebrow">A FEW THINGS TO KNOW</p>
            <h2 id="landing-faq-title">
              Before you
              <br />
              press play.
            </h2>
          </div>
          <div className="landing-faq-items">
            <details>
              <summary>
                Do I need an account to start?<span aria-hidden="true">+</span>
              </summary>
              <p>
                You can explore beats and try the studio without an account.
                Sign in to save projects, create your profile, and invite
                collaborators.
              </p>
            </details>
            <details>
              <summary>
                Can I edit the original beats?<span aria-hidden="true">+</span>
              </summary>
              <p>
                Yes. Open a SESSION Original in Studio to work with its
                instrument, drum, and clip layers. Change the tempo, reshape the
                arrangement, and add your own recordings.
              </p>
            </details>
            <details>
              <summary>
                How do private sessions work?<span aria-hidden="true">+</span>
              </summary>
              <p>
                A room holds up to four collaborators. The host can invite
                SESSION members from the room or copy an invitation link. Your
                camera and microphone stay off until you choose to join the
                call.
              </p>
            </details>
          </div>
        </section>

        <section
          className="landing-final"
          aria-labelledby="landing-final-title"
        >
          <p className="landing-eyebrow">YOU’VE GOT SOMETHING. MAKE IT.</p>
          <h2 id="landing-final-title">
            Let’s make it
            <br />a session.
          </h2>
          <Link
            prefetch={false}
            className="landing-button landing-button-light"
            href="/app?view=Studio"
          >
            Start your next track <ArrowUpRight size={19} />
          </Link>
          <span className="landing-final-decoration" aria-hidden="true">
            <AudioLines strokeWidth={0.7} />
          </span>
        </section>
      </main>

      <footer className="landing-footer">
        <div>
          <Link
            prefetch={false}
            className="landing-logo"
            href="/"
            aria-label="SESSION home"
          >
            session<span>.</span>
          </Link>
          <p>Independent sounds. Shared space.</p>
        </div>
        <nav aria-label="Footer">
          <Link prefetch={false} href="/app?view=Beat%20library">
            Explore beats
          </Link>
          <Link prefetch={false} href="/app?view=Find%20collaborators">
            Find your people
          </Link>
          <Link prefetch={false} href="/app?view=Rights%20%26%20privacy">
            Rights & privacy
          </Link>
        </nav>
        <small>© 2026 SESSION</small>
      </footer>
    </div>
  );
}
