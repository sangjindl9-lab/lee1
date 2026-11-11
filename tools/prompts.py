S = ("Children's coloring book page. Pure black-and-white line art only: bold, thick, smooth, uniform black outlines on a pure white background. "
"Every shape is a large, clearly closed region with no gaps in the lines. Very simple, minimal detail, no tiny patterns. "
"No shading, no gray, no gradients, no hatching, no solid black filled areas (eyes are simple outlined ovals with a small pupil), no color. "
"No text, no letters, no watermark, no logo, no border frame. Original character design, chibi proportions, friendly smiling face, "
"full figure fully visible and centered with white margin around it.")
P = [
("a01","당근을 들고 있는 아기 토끼","animals",1,"A chubby baby rabbit with one floppy ear and a round fluffy tail, standing and hugging a big carrot with both paws, 3/4 view."),
("a02","웃고 있는 아기 고양이","animals",1,"A smiling round baby kitten sitting upright, with a curled tail, a small bell collar and three big stripes on its back, front view."),
("a03","공을 가지고 노는 강아지","animals",1,"A playful puppy with big droopy ears and one large patch around one eye, front paws resting on a big beach ball with wide panels, 3/4 view."),
("a04","대나무를 안고 있는 판다","animals",1,"A round baby panda sitting and hugging a thick bamboo stalk with three big leaves. The panda's ears, eye patches, arms and legs are drawn as empty outlined shapes, not filled black. Front view."),
("a05","꼬리가 풍성한 아기 여우","animals",1,"A baby fox sitting with a huge fluffy tail curled around its side, big pointed ears, a large chest bib shape and tail tip outlined, 3/4 view."),
("a06","꿀단지를 안고 있는 곰","animals",1,"A chubby bear cub sitting and hugging a big round honey pot with drips of honey on the rim and a wooden honey dipper, front view. No writing on the pot."),
("a07","목도리를 두른 아기 펭귄","animals",1,"A round baby penguin wearing a long scarf with wide stripes and a pom-pom beanie hat, standing with flippers out. The penguin body is drawn as empty outlined shapes, not filled black. Front view."),
("a08","물을 뿌리는 아기 코끼리","animals",2,"A baby elephant with big round ears standing and spraying a fountain of large water drops from its raised trunk, a small puddle at its feet, 3/4 view."),
("a09","웃고 있는 아기 티라노사우루스","dinos",1,"A smiling chubby baby tyrannosaurus with a big head, tiny arms, a rounded tail and a few large round spots on its back, standing, 3/4 view."),
("a10","꽃밭에 있는 트리케라톱스","dinos",2,"A cute baby triceratops with a big scalloped frill and three short rounded horns standing among five large simple flowers with big petals, 3/4 view."),
("a11","나뭇잎을 먹는 브라키오사우루스","dinos",2,"A cute long-necked baby brachiosaurus munching a large leaf from a simple round-topped tree with a few big leaves, side 3/4 view."),
("a12","꼬리를 흔드는 스테고사우루스","dinos",2,"A cute baby stegosaurus with big rounded plates along its back and a wagging tail with motion curves, walking happily, side 3/4 view."),
("a13","하늘을 나는 귀여운 익룡","dinos",2,"A cute baby pterosaur with wide rounded wings and a small head crest gliding in the sky between two large puffy clouds and a big simple sun, 3/4 view."),
("a14","둥글고 귀여운 안킬로사우루스","dinos",1,"A very round cute baby ankylosaurus with a shell made of large rounded plates and a ball-shaped club tail, standing, 3/4 view."),
("a15","둥근 머리의 친구 로봇","space",1,"A friendly robot with a big round dome head, one antenna with a ball tip, a boxy body with a large heart panel on its chest, tube arms waving hello, front view."),
("a16","작은 청소 로봇","space",2,"A small cute cleaning robot shaped like a rounded bucket on two wheels, holding a mop in one arm and a feather duster in the other, with three big soap bubbles floating nearby, 3/4 view."),
("a17","바퀴 달린 탐험 로봇","space",2,"A cute explorer rover robot with six chunky wheels, a periscope-like neck with two big camera eyes, a satellite dish on its back, driving over a rocky ground with two big rocks, 3/4 view."),
("a18","달 위에 서 있는 어린이 우주비행사","space",2,"A child astronaut in a puffy spacesuit with a big round helmet standing on the curved moon surface with three large craters, holding a blank flag with no symbol, a few large stars around, front view."),
("a19","별을 들고 있는 외계 친구","space",1,"A friendly little alien friend with three eyes on short stalks, a teardrop-shaped body and tiny feet, holding a big five-pointed star above its head, front view."),
("a20","우주선을 타는 탐험가","space",2,"A happy child explorer waving from the round window of a chubby rocket spaceship with three fins and a big flame cloud, a ringed planet and two large stars nearby, 3/4 view."),
("a21","무지개 옆의 아기 유니콘","fantasy",2,"A baby unicorn with a spiral horn, wavy mane and tail made of large simple locks, standing beside a big rainbow with wide bands that ends in a puffy cloud, 3/4 view."),
("a22","작은 날개가 달린 아기 용","fantasy",1,"A chubby baby dragon with tiny wings, a round belly with wide belly stripes, small horns and a tail ending in a leaf shape, sitting, 3/4 view."),
("a23","꽃 위에 앉은 요정","fantasy",2,"A tiny child fairy with large rounded butterfly-like wings and a petal dress, sitting on top of one giant daisy flower with big petals and two large leaves, front view."),
("a24","웃는 구름 요정","fantasy",1,"A smiling puffy cloud sprite character with a happy face, small arms and legs, wearing a tiny crown, with three large raindrops and a small rainbow arc beside it, front view."),
("a25","별 모양의 귀여운 캐릭터","fantasy",1,"A cute chubby five-pointed star character with a happy face, small arms and legs, wearing boots and a short cape, with two small outlined stars beside it, front view."),
("a26","버섯집에 사는 숲의 정령","fantasy",3,"A small forest spirit with a leaf hat and a round body standing next to a mushroom house that has a round door, one round window, a chimney and big spots on its cap, with two large flowers and grass tufts, 3/4 view."),
("a27","웃는 얼굴의 소방차","vehicles",2,"A cute cartoon fire engine with a smiling face on its front (big eyes as headlights, smile on the bumper), a ladder on top, a hose reel on the side and chunky wheels, 3/4 view."),
("a28","귀여운 경찰차","vehicles",1,"A cute rounded cartoon patrol car with a smiling face on its front, a light bar on the roof, a blank star-shaped emblem on the door and chunky wheels, 3/4 view. No words or numbers."),
("a29","눈이 달린 노란 굴착기","vehicles",2,"A cute cartoon excavator digger with big friendly eyes on its cabin, a smiling mouth, a jointed arm with a big bucket scooping, caterpillar tracks drawn with a few large segments, a small pile of dirt, 3/4 view."),
("a30","웃고 있는 작은 기차","vehicles",2,"A cute little steam train engine with a smiling face on its round front, a funnel puffing three large round smoke clouds, one small wagon behind, big wheels, on a short piece of track, 3/4 view."),
]
# 처음 생성본이 가장자리에서 잘려 여백 문구를 덧붙여 다시 생성한 도안
M = ("The whole drawing is zoomed out and small enough to fit entirely inside the canvas, with a wide empty white margin on all four sides; "
"nothing touches or is cut off by the image edges.")
RETRY = {"a03", "a04", "a06", "a07", "a09", "a10", "a11", "a13", "a18", "a19", "a22", "a23", "a27", "a30"}
def full_prompt(aid, subject):
    return subject + " " + S + (" " + M if aid in RETRY else "")
MODEL = "gpt_image_2_6 (Higgsfield / GPT Image 2.6)"
MODEL_PARAMS = {"aspect_ratio": "1:1", "quality": "medium", "resolution": "2k"}
CATEGORIES = [
    {"id": "animals", "title": "동물 친구들"},
    {"id": "dinos", "title": "공룡 친구들"},
    {"id": "space", "title": "로봇과 우주"},
    {"id": "fantasy", "title": "판타지 친구들"},
    {"id": "vehicles", "title": "탈것 친구들"},
]
