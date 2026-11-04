export function Fox({
  className = "",
  celebrate = false,
}: {
  className?: string;
  celebrate?: boolean;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 240 250"
      fill="none"
      aria-hidden="true"
    >
      <ellipse cx="126" cy="232" rx="75" ry="10" fill="#512d70" opacity=".08" />
      <path d="M161 149c85-15 73 66 28 65-29 0-36-26-28-65Z" fill="#EB7B37" />
      <path d="M211 169c11 25-7 49-30 43 9-19 18-28 30-43Z" fill="#FFF4DC" />
      <path
        d="M93 139c-28 18-34 60-20 79 19 17 73 16 94-1 13-27 2-66-23-79Z"
        fill="#F49345"
      />
      <path
        d="M112 153c-17 17-22 50-8 67 14 7 29 7 43-1 10-22-1-53-18-66Z"
        fill="#FFF4DC"
      />
      <path
        d="m75 78-8-66 53 39M143 48l50-36-6 72"
        fill="#F49345"
        stroke="#F49345"
        strokeWidth="10"
        strokeLinejoin="round"
      />
      <path d="m79 59-3-30 29 23M157 52l24-23-1 35" fill="#8F3D40" />
      <path
        d="M63 80c5-36 42-48 65-45 40-3 66 24 68 57-1 46-30 74-67 77-41-3-72-39-66-89Z"
        fill="#F49345"
      />
      <path
        d="M62 92c22-4 46 11 65 40 21-28 44-43 69-38-2 39-35 70-69 75-37-7-61-35-65-77Z"
        fill="#FFF4DC"
      />
      <ellipse cx="94" cy="93" rx="5" ry="8" fill="#3E2B38" />
      <ellipse cx="158" cy="93" rx="5" ry="8" fill="#3E2B38" />
      <path
        d="M116 126c0-7 22-7 22 0-1 5-8 9-11 9s-11-4-11-9Z"
        fill="#3E2B38"
      />
      <path
        d="M119 143q8 8 16 0"
        stroke="#6E3E3F"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <ellipse cx="81" cy="113" rx="10" ry="5" fill="#F07D6B" opacity=".6" />
      <ellipse cx="173" cy="113" rx="10" ry="5" fill="#F07D6B" opacity=".6" />
      <path
        d="M77 159q-32 23-27 41"
        stroke="#F49345"
        strokeWidth="20"
        strokeLinecap="round"
      />
      <path
        d={celebrate ? "M159 164q37-20 40-47" : "M159 164q29 2 31 26"}
        stroke="#F49345"
        strokeWidth="20"
        strokeLinecap="round"
      />
      <path
        d="M83 222v7m67-7v7"
        stroke="#98503C"
        strokeWidth="22"
        strokeLinecap="round"
      />
      <path d="m91 158 36 13 31-15-12 27-20-6-20 7Z" fill="#6E54C6" />
      <circle cx="127" cy="174" r="7" fill="#8D74DD" />
    </svg>
  );
}
export function MathWorld() {
  return (
    <svg viewBox="0 0 300 190" fill="none" aria-hidden="true">
      <ellipse cx="151" cy="170" rx="124" ry="12" fill="#EEC399" opacity=".5" />
      <path d="M29 167h242l-40-69-30 18-47-67-49 62-25-14Z" fill="#F9C18B" />
      <path d="m105 111 49-62 30 43-24-9-12 12-9-7Z" fill="#FFF8EB" />
      <rect x="69" y="96" width="72" height="69" rx="10" fill="#F48E4F" />
      <path d="m73 100 31-19 34 18-32 20Z" fill="#FFBA6D" />
      <path d="m106 119 35-20v56l-35 18Z" fill="#E77B3C" />
      <text x="85" y="151" fontSize="36" fontWeight="800" fill="#FFF7E8">
        2
      </text>
      <rect x="142" y="117" width="63" height="49" rx="9" fill="#F9CF63" />
      <text x="158" y="154" fontSize="36" fontWeight="800" fill="#A36125">
        3
      </text>
      <rect
        x="184"
        y="63"
        width="62"
        height="75"
        rx="11"
        transform="rotate(10 184 63)"
        fill="#FFF8E9"
      />
      <rect
        x="196"
        y="77"
        width="40"
        height="15"
        rx="4"
        transform="rotate(10 196 77)"
        fill="#D2E5C9"
      />
      <path
        d="m197 109 27 5m-11-16-5 27"
        stroke="#ECA15D"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="62" cy="58" r="17" fill="#FFD873" />
      <path
        d="m56 58 12 0m-6-6v12"
        stroke="#AF7626"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="m256 105 5 7 9-2-5 8 3 8-9-2-6 6 1-9-7-6 9-1Z" fill="#E89A61" />
      <path
        d="m109 53 5 5m-5 0 5-5"
        stroke="#EBB57F"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function EnglishWorld() {
  return (
    <svg viewBox="0 0 300 190" fill="none" aria-hidden="true">
      <ellipse
        cx="151"
        cy="170"
        rx="121"
        ry="12"
        fill="#CFC2EF"
        opacity=".55"
      />
      <path
        d="M82 129c-27-10-35-54-9-66 29-13 48 13 48 49m90 31c32-3 39-27 26-40-17-17-35-4-35 20"
        fill="#BBA5DC"
      />
      <path
        d="M143 76c-27-20-66-12-79-2v79c31-12 55-5 79 10 24-15 50-22 82-10V74c-29-15-55-17-82 2Z"
        fill="#8C6DCF"
      />
      <path
        d="M143 69c-21-13-45-18-71-6v79c25-8 50-3 71 14 22-17 45-22 74-14V63c-26-12-52-7-74 6Z"
        fill="#FFF9EF"
      />
      <path d="M143 69v87" stroke="#DACBE8" strokeWidth="3" />
      <path
        d="m86 85 40 10m-40 5 40 10m-40 5 40 10m36-30 39-10m-39 25 39-10m-39 25 39-10"
        stroke="#C5B4DC"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <rect
        x="190"
        y="26"
        width="41"
        height="44"
        rx="10"
        transform="rotate(12 190 26)"
        fill="#F4B4BD"
      />
      <text
        x="197"
        y="59"
        fontSize="28"
        fontWeight="800"
        fill="#9C546F"
        transform="rotate(12 197 59)"
      >
        A
      </text>
      <circle cx="73" cy="38" r="17" fill="#C4B3EC" />
      <text x="62" y="47" fontSize="24" fontWeight="800" fill="#7354A7">
        B
      </text>
      <path d="m247 79 4 8 9 1-7 6 2 9-8-5-8 4 2-9-6-7 9 1Z" fill="#E3B961" />
      <path
        d="m105 25 6 6m-6 0 6-6"
        stroke="#AC96CE"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function DiscoveryWorld({ globe = false }: { globe?: boolean }) {
  return (
    <svg viewBox="0 0 300 190" fill="none" aria-hidden="true">
      <ellipse cx="151" cy="170" rx="120" ry="12" fill="#A9C6A0" opacity=".3" />
      {globe ? (
        <>
          <circle cx="155" cy="97" r="63" fill="#B1D6E5" />
          <path
            d="m112 47 20 12-6 20 22 19-6 19-24-2-7-19-16-7m84-48-6 24 23 11 15-6 4 29-17 4-12 24-3 28-21-8-6-25-21-13 10-18 13-8-5-30"
            fill="#8EB89B"
          />
          <path
            d="M147 164v11m-33 0h75"
            stroke="#A4A8B9"
            strokeWidth="9"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <path
            d="M148 164v-80"
            stroke="#A89068"
            strokeWidth="14"
            strokeLinecap="round"
          />
          <path
            d="M150 108c-73-4-84-60-63-79 45-1 70 33 63 79Z"
            fill="#B0C9A0"
          />
          <path
            d="M152 122c-6-56 31-88 65-84 16 40-6 79-65 84Z"
            fill="#8EAF83"
          />
          <path
            d="m149 148-33-22m37 5 29-25"
            stroke="#A89068"
            strokeWidth="6"
            strokeLinecap="round"
          />
        </>
      )}
      <circle cx="68" cy="103" r="12" fill="#F3D888" />
      <path
        d="m228 135 5-10 4 10 11 2-8 7 2 11-9-6-10 5 3-11-8-7Z"
        fill="#DFC187"
      />
    </svg>
  );
}
