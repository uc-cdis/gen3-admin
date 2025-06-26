import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import { CircleCheckBig, OctagonX } from "lucide-react";

export default function CustomSelect() {
    return(
        <div>
            <Select>
                <SelectTrigger className="w-[32rem]">
                    <SelectValue placeholder="Select an environment" />
                </SelectTrigger>
                <SelectContent className="w-full font-mono">
                    <SelectItem value="gen3-test/abhijith-test" className="w-full">
                        <div className="flex items-center justify-between gap-[10.3rem]">
                            <div>gen3-test/abhijith-test</div>
                            <div className="flex justify-center items-center gap-2">
                                <div className="text-sm rounded-2xl text-blue-600 bg-blue-200 ring-1 ring-blue-400 px-2">default</div>
                                <CircleCheckBig className="h-4 w-4 text-yellow-400" />
                            </div>
                        </div>
                    </SelectItem>
                    <SelectItem value="gen3-test/gen3">
                        <div className="flex items-center justify-between gap-[15rem]">
                            <div>gen3-test/gen3</div>
                            <div className="flex justify-center items-center gap-2">
                                <div className="text-sm rounded-2xl text-blue-600 bg-blue-200 ring-1 ring-blue-400 px-2">default</div>
                                <OctagonX className="h-4 w-4 text-red-500" />
                            </div>
                        </div>
                    </SelectItem>
                </SelectContent>
            </Select>
        </div>
    )
}
